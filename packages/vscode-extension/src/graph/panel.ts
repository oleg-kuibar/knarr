import * as vscode from "vscode";
import type { KnarrStateWatcher } from "../state-watcher";

export class GraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private panelDisposables: vscode.Disposable[] = [];

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
      "knarr.dependencyGraph",
      "Knarr: Dependency Graph",
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
        this.panelDisposables.forEach((d) => d.dispose());
        this.panelDisposables = [];
        this.panel = undefined;
      },
      null,
      this.disposables
    );

    this.panelDisposables.push(
      this.watcher.onDidChange(async (event) => {
        if (event === "consumers-changed" || event === "state-changed") {
          await this.updateGraph();
        }
      })
    );

    await this.updateGraph();
  }

  private async updateGraph(): Promise<void> {
    if (!this.panel) return;

    const [projects, consumers] = await Promise.all([
      this.watcher.readAllProjects(),
      this.watcher.readConsumers(),
    ]);

    this.panel.webview.postMessage({
      command: "update",
      projects: projects.map((p) => ({
        label: p.label,
        projectPath: p.projectPath,
        links: p.state.links,
      })),
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
      fill-opacity: 0.15;
      stroke: var(--vscode-charts-blue, #4fc1ff);
      stroke-width: 1.5;
    }
    .node-consumer {
      fill: var(--vscode-charts-green, #89d185);
      fill-opacity: 0.15;
      stroke: var(--vscode-charts-green, #89d185);
      stroke-width: 1.5;
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
    .node-external {
      opacity: 0.4;
    }
    .label-external {
      opacity: 0.5;
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
