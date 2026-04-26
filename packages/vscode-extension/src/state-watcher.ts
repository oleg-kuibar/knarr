import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import type { ConsumerState, ConsumersRegistry, KnarrMeta } from "./types";

export type StateEvent = "state-changed" | "consumers-changed";

export interface ProjectState {
  /** Absolute path to the project folder containing .knarr/state.json */
  projectPath: string;
  /** Short display name (last 1-2 path segments, relative to workspace root) */
  label: string;
  /** Parsed state */
  state: ConsumerState;
}

export class KnarrStateWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly emitter = new vscode.EventEmitter<StateEvent>();
  readonly onDidChange = this.emitter.event;

  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly DEBOUNCE_MS = 200;

  private cachedProjects: ProjectState[] | undefined;
  private cachedConsumers: ConsumersRegistry | undefined;

  constructor(private readonly workspaceRoot: string) {
    this.setupWatchers();
  }

  private get knarrHome(): string {
    return process.env.KNARR_HOME || path.join(os.homedir(), ".knarr");
  }

  private setupWatchers(): void {
    // Watch ALL .knarr/state.json files anywhere in the workspace
    const statePattern = new vscode.RelativePattern(
      this.workspaceRoot,
      "**/.knarr/state.json"
    );
    const stateWatcher = vscode.workspace.createFileSystemWatcher(statePattern);
    stateWatcher.onDidChange(() => this.debouncedEmit("state-changed"));
    stateWatcher.onDidCreate(() => this.debouncedEmit("state-changed"));
    stateWatcher.onDidDelete(() => {
      this.cachedProjects = undefined;
      this.debouncedEmit("state-changed");
    });
    this.disposables.push(stateWatcher);

    // Watch global consumers.json
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
      if (event === "state-changed") this.cachedProjects = undefined;
      if (event === "consumers-changed") this.cachedConsumers = undefined;
      this.emitter.fire(event);
    }, this.DEBOUNCE_MS);
  }

  /** Discover and read all .knarr/state.json files in the workspace */
  async readAllProjects(): Promise<ProjectState[]> {
    if (this.cachedProjects) return this.cachedProjects;

    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      "**/.knarr/state.json"
    );
    const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**");

    const projects: ProjectState[] = [];
    for (const uri of files) {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const state: ConsumerState = JSON.parse(
          Buffer.from(data).toString("utf-8")
        );
        // .knarr/state.json is inside <project>/.knarr/, so go up two levels
        const projectPath = path.dirname(path.dirname(uri.fsPath));
        const relative = path.relative(this.workspaceRoot, projectPath);
        const label = relative || path.basename(projectPath);
        projects.push({ projectPath, label: label.replace(/\\/g, "/"), state });
      } catch {
        // Skip malformed files
      }
    }

    projects.sort((a, b) => a.label.localeCompare(b.label));
    this.cachedProjects = projects;
    return projects;
  }

  /** Read store metadata for a specific package */
  async readStoreMeta(
    packageName: string,
    version: string
  ): Promise<KnarrMeta | undefined> {
    try {
      const encoded = packageName.replace(/\//g, "+");
      const metaPath = path.join(
        this.knarrHome,
        "store",
        `${encoded}@${version}`,
        ".knarr-meta.json"
      );
      const uri = vscode.Uri.file(metaPath);
      const data = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(data).toString("utf-8"));
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
