# Knarr VSCode Extension Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a read-only VSCode extension that shows linked Knarr packages in a sidebar tree view and a dependency graph in a WebView panel.

**Architecture:** Native TreeDataProvider for the sidebar, WebView panel with ELK.js for the dependency graph, shared KnarrStateWatcher for file monitoring. All data is read from Knarr's existing state files (`.knarr/state.json`, `~/.knarr/consumers.json`, store metadata).

**Tech Stack:** TypeScript, VSCode Extension API (`@types/vscode`), ELK.js (graph layout), esbuild (bundling)

---

### Task 1: Scaffold Extension Project

**Files:**
- Create: `packages/vscode-extension/package.json`
- Create: `packages/vscode-extension/tsconfig.json`
- Create: `packages/vscode-extension/.vscodeignore`

**Step 1: Create extension package.json**

```json
{
  "name": "Knarr-vscode",
  "displayName": "Knarr",
  "description": "Status and dependency visualization for Knarr-linked packages",
  "version": "0.1.0",
  "publisher": "olegkuibar",
  "license": "MIT",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": [
    "workspaceContains:**/.knarr/state.json"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "Knarr-explorer",
          "title": "Knarr",
          "icon": "resources/Knarr-icon.svg"
        }
      ]
    },
    "views": {
      "Knarr-explorer": [
        {
          "id": "Knarr.linkedPackages",
          "name": "Linked Packages"
        }
      ]
    },
    "commands": [
      {
        "command": "Knarr.refresh",
        "title": "Refresh",
        "category": "Knarr",
        "icon": "$(refresh)"
      },
      {
        "command": "Knarr.showGraph",
        "title": "Show Dependency Graph",
        "category": "Knarr"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "Knarr.refresh",
          "when": "view == Knarr.linkedPackages",
          "group": "navigation"
        }
      ]
    }
  },
  "scripts": {
    "build": "esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node --sourcemap && esbuild src/graph/webview/graph.ts --bundle --outfile=dist/webview/graph.js --format=iife --platform=browser --sourcemap",
    "watch": "npm run build -- --watch",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.9.3"
  },
  "dependencies": {
    "elkjs": "^0.9.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": false,
    "moduleResolution": "node"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .vscodeignore**

```
src/**
node_modules/**
tsconfig.json
*.map
.gitignore
```

**Step 4: Create placeholder icon**

Create `packages/vscode-extension/resources/Knarr-icon.svg` — a simple SVG icon (box with arrow, representing package linking):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
  <polyline points="7.5 4.21 12 6.81 16.5 4.21"/>
  <polyline points="7.5 19.79 7.5 14.6 3 12"/>
  <polyline points="21 12 16.5 14.6 16.5 19.79"/>
  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
  <line x1="12" y1="22.08" x2="12" y2="12"/>
</svg>
```

**Step 5: Install dependencies**

Run: `cd packages/vscode-extension && pnpm install`

**Step 6: Commit**

```bash
git add packages/vscode-extension/package.json packages/vscode-extension/tsconfig.json packages/vscode-extension/.vscodeignore packages/vscode-extension/resources/
git commit -m "feat(vscode): scaffold extension project structure"
```

---

### Task 2: Types Module

**Files:**
- Create: `packages/vscode-extension/src/types.ts`

**Step 1: Create types file**

These mirror Knarr's types from `src/types.ts` but are standalone (no cross-package import, since this extension is independent).

```typescript
/** Consumer project state file (.knarr/state.json) */
export interface ConsumerState {
  version: "1";
  packageManager?: PackageManager;
  role?: "consumer" | "library";
  links: Record<string, LinkEntry>;
}

/** Tracks a single linked package in a consumer project */
export interface LinkEntry {
  version: string;
  contentHash: string;
  linkedAt: string;
  sourcePath: string;
  backupExists: boolean;
  packageManager: PackageManager;
  buildId?: string;
}

/** Global consumers registry (~/.knarr/consumers.json) */
export interface ConsumersRegistry {
  [packageName: string]: string[];
}

/** Store metadata (.knarr-meta.json) */
export interface KnarrMeta {
  schemaVersion?: number;
  contentHash: string;
  publishedAt: string;
  sourcePath: string;
  buildId?: string;
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
```

**Step 2: Commit**

```bash
git add packages/vscode-extension/src/types.ts
git commit -m "feat(vscode): add type definitions for Knarr state files"
```

---

### Task 3: State Watcher

**Files:**
- Create: `packages/vscode-extension/src/state-watcher.ts`

**Step 1: Implement KnarrStateWatcher**

```typescript
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import type { ConsumerState, ConsumersRegistry } from "./types";

export type StateEvent = "state-changed" | "consumers-changed";

export class KnarrStateWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<StateEvent>();
  readonly onDidChange = this.emitter.event;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly DEBOUNCE_MS = 200;

  private cachedState: ConsumerState | undefined;
  private cachedConsumers: ConsumersRegistry | undefined;

  constructor(private readonly workspaceRoot: string) {
    this.setupWatchers();
  }

  private get KnarrHome(): string {
    return process.env.KNARR_HOME || path.join(os.homedir(), ".knarr");
  }

  private setupWatchers(): void {
    // Watch local .knarr/state.json
    const statePattern = new vscode.RelativePattern(
      this.workspaceRoot,
      ".knarr/state.json"
    );
    const stateWatcher = vscode.workspace.createFileSystemWatcher(statePattern);
    stateWatcher.onDidChange(() => this.debouncedEmit("state-changed"));
    stateWatcher.onDidCreate(() => this.debouncedEmit("state-changed"));
    stateWatcher.onDidDelete(() => {
      this.cachedState = undefined;
      this.debouncedEmit("state-changed");
    });
    this.disposables.push(stateWatcher);

    // Watch global consumers.json
    const consumersPath = path.join(this.knarrHome, "consumers.json");
    const consumersPattern = new vscode.RelativePattern(
      vscode.Uri.file(this.knarrHome),
      "consumers.json"
    );
    const consumersWatcher =
      vscode.workspace.createFileSystemWatcher(consumersPattern);
    consumersWatcher.onDidChange(() => this.debouncedEmit("consumers-changed"));
    consumersWatcher.onDidCreate(() => this.debouncedEmit("consumers-changed"));
    consumersWatcher.onDidDelete(() => {
      this.cachedConsumers = undefined;
      this.debouncedEmit("consumers-changed");
    });
    this.disposables.push(consumersWatcher);
  }

  private debouncedEmit(event: StateEvent): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      // Invalidate cache for the changed source
      if (event === "state-changed") this.cachedState = undefined;
      if (event === "consumers-changed") this.cachedConsumers = undefined;
      this.emitter.fire(event);
    }, this.DEBOUNCE_MS);
  }

  async readState(): Promise<ConsumerState | undefined> {
    if (this.cachedState) return this.cachedState;
    try {
      const uri = vscode.Uri.file(
        path.join(this.workspaceRoot, ".knarr", "state.json")
      );
      const data = await vscode.workspace.fs.readFile(uri);
      this.cachedState = JSON.parse(Buffer.from(data).toString("utf-8"));
      return this.cachedState;
    } catch {
      return undefined;
    }
  }

  async readConsumers(): Promise<ConsumersRegistry | undefined> {
    if (this.cachedConsumers) return this.cachedConsumers;
    try {
      const uri = vscode.Uri.file(
        path.join(this.knarrHome, "consumers.json")
      );
      const data = await vscode.workspace.fs.readFile(uri);
      this.cachedConsumers = JSON.parse(Buffer.from(data).toString("utf-8"));
      return this.cachedConsumers;
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.emitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
```

**Step 2: Commit**

```bash
git add packages/vscode-extension/src/state-watcher.ts
git commit -m "feat(vscode): add KnarrStateWatcher with debounced file watching"
```

---

### Task 4: Tree View — TreeItem Classes

**Files:**
- Create: `packages/vscode-extension/src/tree/items.ts`

**Step 1: Implement tree item classes**

```typescript
import * as vscode from "vscode";
import type { LinkEntry } from "../types";

/** Top-level node: a linked package */
export class PackageItem extends vscode.TreeItem {
  constructor(
    public readonly packageName: string,
    public readonly link: LinkEntry
  ) {
    super(packageName, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = link.version;
    this.tooltip = `${packageName}@${link.version}`;
    this.iconPath = new vscode.ThemeIcon("package");
    this.contextValue = "KnarrPackage";
  }
}

/** Child node: a metadata field of a linked package */
export class MetadataItem extends vscode.TreeItem {
  constructor(label: string, value: string, icon?: string) {
    super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = icon ? new vscode.ThemeIcon(icon) : undefined;
    this.contextValue = "KnarrMetadata";
  }
}

/** Helper: build metadata children for a linked package */
export function buildMetadataItems(link: LinkEntry): MetadataItem[] {
  const items: MetadataItem[] = [];

  items.push(new MetadataItem("Source", shortenPath(link.sourcePath), "folder"));
  items.push(new MetadataItem("Linked", formatRelativeTime(link.linkedAt), "clock"));

  if (link.buildId) {
    items.push(new MetadataItem("Build", link.buildId, "tag"));
  }

  items.push(
    new MetadataItem(
      "Backup",
      link.backupExists ? "\u2713" : "\u2717",
      link.backupExists ? "pass" : "warning"
    )
  );

  return items;
}

function shortenPath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && p.startsWith(home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

**Step 2: Commit**

```bash
git add packages/vscode-extension/src/tree/items.ts
git commit -m "feat(vscode): add tree item classes for linked packages"
```

---

### Task 5: Tree View — TreeDataProvider

**Files:**
- Create: `packages/vscode-extension/src/tree/provider.ts`

**Step 1: Implement the provider**

```typescript
import * as vscode from "vscode";
import type { KnarrStateWatcher } from "../state-watcher";
import { PackageItem, MetadataItem, buildMetadataItems } from "./items";

type TreeNode = PackageItem | MetadataItem;

export class KnarrTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly watcher: KnarrStateWatcher) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      // Root level: list all linked packages
      const state = await this.watcher.readState();
      if (!state || !state.links) return [];

      return Object.entries(state.links)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, link]) => new PackageItem(name, link));
    }

    if (element instanceof PackageItem) {
      return buildMetadataItems(element.link);
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
```

**Step 2: Commit**

```bash
git add packages/vscode-extension/src/tree/provider.ts
git commit -m "feat(vscode): add TreeDataProvider for linked packages sidebar"
```

---

### Task 6: Graph WebView — Panel Lifecycle

**Files:**
- Create: `packages/vscode-extension/src/graph/panel.ts`

**Step 1: Implement WebView panel manager**

```typescript
import * as vscode from "vscode";
import type { KnarrStateWatcher } from "../state-watcher";

export class GraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly watcher: KnarrStateWatcher
  ) {}

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      await this.updateGraph();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "Knarr.dependencyGraph",
      "knarr: Dependency Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        ],
      }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      null,
      this.disposables
    );

    // Listen for consumer changes to auto-refresh graph
    this.watcher.onDidChange(
      async (event) => {
        if (event === "consumers-changed" || event === "state-changed") {
          await this.updateGraph();
        }
      },
      null,
      this.disposables
    );

    await this.updateGraph();
  }

  private async updateGraph(): Promise<void> {
    if (!this.panel) return;

    const [state, consumers] = await Promise.all([
      this.watcher.readState(),
      this.watcher.readConsumers(),
    ]);

    this.panel.webview.postMessage({
      command: "update",
      state: state ?? null,
      consumers: consumers ?? null,
    });
  }

  private getHtml(): string {
    const webview = this.panel!.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "graph.js")
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knarr Dependency Graph</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-font-family, sans-serif);
    }
    #graph {
      width: 100vw;
      height: 100vh;
    }
    .node-library {
      fill: var(--vscode-charts-blue, #4fc1ff);
    }
    .node-consumer {
      fill: var(--vscode-charts-green, #89d185);
    }
    .edge {
      stroke: var(--vscode-editorWidget-border, #454545);
      stroke-width: 1.5;
      fill: none;
    }
    .label {
      fill: var(--vscode-editor-foreground, #d4d4d4);
      font-size: 12px;
      text-anchor: middle;
      dominant-baseline: central;
    }
    .tooltip {
      position: absolute;
      background: var(--vscode-editorHoverWidget-background, #252526);
      border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      pointer-events: none;
      display: none;
      z-index: 10;
    }
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      opacity: 0.6;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="graph"></div>
  <div class="tooltip" id="tooltip"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

**Step 2: Commit**

```bash
git add packages/vscode-extension/src/graph/panel.ts
git commit -m "feat(vscode): add WebView panel for dependency graph"
```

---

### Task 7: Graph WebView — ELK.js Rendering

**Files:**
- Create: `packages/vscode-extension/src/graph/webview/graph.ts`

This file runs in the browser WebView context, not in the extension host.

**Step 1: Implement the graph renderer**

```typescript
import ELK from "elkjs/lib/elk.bundled.js";

interface GraphMessage {
  command: "update";
  state: {
    links: Record<string, { version: string; linkedAt: string; buildId?: string }>;
  } | null;
  consumers: Record<string, string[]> | null;
}

interface LayoutNode {
  id: string;
  type: "library" | "consumer";
  label: string;
  meta?: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  sections?: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
}

const vscode = acquireVsCodeApi();
const elk = new ELK();

const graphEl = document.getElementById("graph")!;
const tooltipEl = document.getElementById("tooltip")!;

let currentNodes: LayoutNode[] = [];
let currentEdges: LayoutEdge[] = [];

// Pan/zoom state
let panX = 0;
let panY = 0;
let scale = 1;
let isPanning = false;
let lastMouse = { x: 0, y: 0 };

window.addEventListener("message", async (event: MessageEvent<GraphMessage>) => {
  const msg = event.data;
  if (msg.command === "update") {
    await layoutAndRender(msg.state, msg.consumers);
  }
});

async function layoutAndRender(
  state: GraphMessage["state"],
  consumers: GraphMessage["consumers"]
): Promise<void> {
  if (!consumers || Object.keys(consumers).length === 0) {
    graphEl.innerHTML = '<div class="empty-state">No linked packages found</div>';
    return;
  }

  // Build unique nodes
  const nodeMap = new Map<string, LayoutNode>();
  const edges: Array<{ id: string; sources: string[]; targets: string[] }> = [];

  let edgeIdx = 0;
  for (const [pkgName, consumerPaths] of Object.entries(consumers)) {
    const libId = `lib:${pkgName}`;
    if (!nodeMap.has(libId)) {
      const linkInfo = state?.links?.[pkgName];
      const meta = linkInfo
        ? `v${linkInfo.version}${linkInfo.buildId ? ` (${linkInfo.buildId})` : ""}`
        : "";
      nodeMap.set(libId, {
        id: libId,
        type: "library",
        label: pkgName,
        meta,
        width: Math.max(120, pkgName.length * 8 + 24),
        height: 40,
      });
    }

    for (const consumerPath of consumerPaths) {
      const consId = `con:${consumerPath}`;
      if (!nodeMap.has(consId)) {
        const shortPath = consumerPath.split("/").slice(-2).join("/");
        nodeMap.set(consId, {
          id: consId,
          type: "consumer",
          label: shortPath,
          width: Math.max(120, shortPath.length * 8 + 24),
          height: 40,
        });
      }

      edges.push({
        id: `e${edgeIdx++}`,
        sources: [libId],
        targets: [consId],
      });
    }
  }

  // Run ELK layout
  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.padding": "[top=20,left=20,bottom=20,right=20]",
    },
    children: Array.from(nodeMap.values()).map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      labels: [{ text: n.label }],
    })),
    edges,
  };

  try {
    const laid = await elk.layout(elkGraph);

    // Update node positions from layout result
    for (const child of laid.children || []) {
      const node = nodeMap.get(child.id);
      if (node) {
        node.x = child.x ?? 0;
        node.y = child.y ?? 0;
        node.width = child.width ?? node.width;
        node.height = child.height ?? node.height;
      }
    }

    currentNodes = Array.from(nodeMap.values());
    currentEdges = (laid.edges || []).map((e: any) => ({
      id: e.id,
      source: e.sources[0],
      target: e.targets[0],
      sections: e.sections,
    }));

    render();
  } catch (err) {
    graphEl.innerHTML = `<div class="empty-state">Layout error: ${err}</div>`;
  }
}

function render(): void {
  // Build SVG
  const svgNs = "http://www.w3.org/2000/svg";

  // Calculate viewBox bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of currentNodes) {
    const nx = n.x ?? 0;
    const ny = n.y ?? 0;
    minX = Math.min(minX, nx);
    minY = Math.min(minY, ny);
    maxX = Math.max(maxX, nx + n.width);
    maxY = Math.max(maxY, ny + n.height);
  }
  const pad = 40;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  let svg = `<svg xmlns="${svgNs}" width="100%" height="100%"
    viewBox="${minX - pad} ${minY - pad} ${vbW} ${vbH}"
    style="transform: translate(${panX}px, ${panY}px) scale(${scale}); transform-origin: center;">`;

  // Draw edges
  for (const edge of currentEdges) {
    if (edge.sections) {
      for (const section of edge.sections) {
        let d = `M ${section.startPoint.x} ${section.startPoint.y}`;
        if (section.bendPoints) {
          for (const bp of section.bendPoints) {
            d += ` L ${bp.x} ${bp.y}`;
          }
        }
        d += ` L ${section.endPoint.x} ${section.endPoint.y}`;
        svg += `<path class="edge" d="${d}" marker-end="url(#arrowhead)"/>`;
      }
    }
  }

  // Arrowhead marker
  svg += `<defs><marker id="arrowhead" viewBox="0 0 10 7" refX="10" refY="3.5"
    markerWidth="8" markerHeight="6" orient="auto-start-reverse">
    <polygon points="0 0, 10 3.5, 0 7" fill="var(--vscode-editorWidget-border, #454545)"/>
  </marker></defs>`;

  // Draw nodes
  for (const node of currentNodes) {
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;

    if (node.type === "library") {
      // Circle-ish: rounded rect with large border-radius
      svg += `<rect x="${nx}" y="${ny}" width="${node.width}" height="${node.height}"
        rx="20" ry="20" class="node-library"
        data-id="${node.id}" data-meta="${node.meta || ""}" />`;
    } else {
      // Rectangle for consumers
      svg += `<rect x="${nx}" y="${ny}" width="${node.width}" height="${node.height}"
        rx="4" ry="4" class="node-consumer"
        data-id="${node.id}" />`;
    }

    svg += `<text class="label" x="${nx + node.width / 2}" y="${ny + node.height / 2}">${escapeHtml(node.label)}</text>`;
  }

  svg += "</svg>";
  graphEl.innerHTML = svg;

  // Attach hover events
  graphEl.querySelectorAll("rect[data-id]").forEach((el) => {
    el.addEventListener("mouseenter", (e) => {
      const target = e.target as SVGElement;
      const id = target.getAttribute("data-id") ?? "";
      const node = currentNodes.find((n) => n.id === id);
      if (!node) return;

      let text = node.label;
      if (node.meta) text += `\n${node.meta}`;

      tooltipEl.textContent = text;
      tooltipEl.style.display = "block";
    });

    el.addEventListener("mousemove", (e) => {
      const me = e as MouseEvent;
      tooltipEl.style.left = me.clientX + 12 + "px";
      tooltipEl.style.top = me.clientY + 12 + "px";
    });

    el.addEventListener("mouseleave", () => {
      tooltipEl.style.display = "none";
    });
  });
}

// Pan/zoom handlers
graphEl.addEventListener("mousedown", (e) => {
  isPanning = true;
  lastMouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener("mousemove", (e) => {
  if (!isPanning) return;
  panX += e.clientX - lastMouse.x;
  panY += e.clientY - lastMouse.y;
  lastMouse = { x: e.clientX, y: e.clientY };
  const svg = graphEl.querySelector("svg");
  if (svg) {
    svg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }
});

window.addEventListener("mouseup", () => {
  isPanning = false;
});

graphEl.addEventListener("wheel", (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  scale = Math.max(0.1, Math.min(3, scale * delta));
  const svg = graphEl.querySelector("svg");
  if (svg) {
    svg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Declare VSCode API type for the webview context
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
```

**Step 2: Commit**

```bash
git add packages/vscode-extension/src/graph/webview/graph.ts
git commit -m "feat(vscode): add ELK.js graph renderer for dependency visualization"
```

---

### Task 8: Extension Entry Point

**Files:**
- Create: `packages/vscode-extension/src/extension.ts`

**Step 1: Wire everything together**

```typescript
import * as vscode from "vscode";
import { KnarrStateWatcher } from "./state-watcher";
import { KnarrTreeProvider } from "./tree/provider";
import { GraphPanel } from "./graph/panel";

let stateWatcher: KnarrStateWatcher | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  stateWatcher = new KnarrStateWatcher(workspaceRoot);
  context.subscriptions.push(stateWatcher);

  // Tree view
  const treeProvider = new KnarrTreeProvider(stateWatcher);
  const treeView = vscode.window.createTreeView("Knarr.linkedPackages", {
    treeDataProvider: treeProvider,
  });
  context.subscriptions.push(treeView);

  // Auto-refresh tree on state changes
  stateWatcher.onDidChange((event) => {
    if (event === "state-changed") {
      treeProvider.refresh();
    }
  });

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("Knarr.refresh", () => {
      treeProvider.refresh();
    })
  );

  // Graph panel
  const graphPanel = new GraphPanel(context.extensionUri, stateWatcher);
  context.subscriptions.push(graphPanel);

  context.subscriptions.push(
    vscode.commands.registerCommand("Knarr.showGraph", () => {
      graphPanel.show();
    })
  );
}

export function deactivate(): void {
  stateWatcher = undefined;
}
```

**Step 2: Verify the build**

Run: `cd packages/vscode-extension && npm run build`
Expected: `dist/extension.js` and `dist/webview/graph.js` created without errors.

**Step 3: Commit**

```bash
git add packages/vscode-extension/src/extension.ts
git commit -m "feat(vscode): add extension entry point wiring tree view and graph panel"
```

---

### Task 9: Build Configuration

**Files:**
- Create: `packages/vscode-extension/esbuild.config.mjs`

**Step 1: Create esbuild config for dev convenience**

The `scripts.build` in package.json already has the esbuild commands. This config file is for programmatic use (e.g., a watch script).

```javascript
import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

/** Extension host bundle (Node/CJS) */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  sourcemap: true,
  target: "node22",
};

/** Webview bundle (browser/IIFE) */
const webviewConfig = {
  entryPoints: ["src/graph/webview/graph.ts"],
  bundle: true,
  outfile: "dist/webview/graph.js",
  format: "iife",
  platform: "browser",
  sourcemap: true,
  target: "es2022",
};

if (isWatch) {
  const extCtx = await esbuild.context(extensionConfig);
  const webCtx = await esbuild.context(webviewConfig);
  await Promise.all([extCtx.watch(), webCtx.watch()]);
  console.log("Watching for changes...");
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(webviewConfig),
  ]);
}
```

**Step 2: Update package.json scripts to use config**

Replace the `build` and `watch` scripts:

```json
{
  "scripts": {
    "build": "node esbuild.config.mjs",
    "watch": "node esbuild.config.mjs --watch",
    "package": "vsce package"
  }
}
```

**Step 3: Verify build**

Run: `cd packages/vscode-extension && pnpm install && npm run build`
Expected: `dist/extension.js` and `dist/webview/graph.js` created.

**Step 4: Commit**

```bash
git add packages/vscode-extension/esbuild.config.mjs packages/vscode-extension/package.json
git commit -m "feat(vscode): add esbuild config with watch mode support"
```

---

### Task 10: Manual Testing & Polish

**Step 1: Add launch.json for extension debugging**

Create `packages/vscode-extension/.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/packages/vscode-extension"
      ],
      "outFiles": [
        "${workspaceFolder}/packages/vscode-extension/dist/**/*.js"
      ],
      "preLaunchTask": "npm: build - packages/vscode-extension"
    }
  ]
}
```

**Step 2: Manual test checklist**

1. Open a project that has `.knarr/state.json` — verify the Knarr icon appears in the activity bar
2. Expand the "Linked Packages" tree — verify packages show with version, source, linked time, backup status
3. Run `knarr publish && Knarr inject` — verify the tree auto-refreshes
4. Open command palette → "knarr: Show Dependency Graph" — verify the graph renders
5. Hover nodes in the graph — verify tooltips appear
6. Zoom and pan — verify smooth interaction
7. Open a project without `.knarr/state.json` — verify the extension does NOT activate

**Step 3: Commit**

```bash
git add packages/vscode-extension/.vscode/launch.json
git commit -m "feat(vscode): add launch config for extension development"
```

---

## Task Dependency Order

```
Task 1 (scaffold) → Task 2 (types) → Task 3 (state watcher)
                                          ↓
                          ┌───────────────┴───────────────┐
                     Task 4 (items)                  Task 6 (panel)
                          ↓                               ↓
                     Task 5 (provider)               Task 7 (graph renderer)
                          └───────────────┬───────────────┘
                                     Task 8 (entry point)
                                          ↓
                                     Task 9 (build config)
                                          ↓
                                     Task 10 (test & polish)
```

Tasks 4-5 and 6-7 can be done in parallel since they are independent (tree vs graph).
