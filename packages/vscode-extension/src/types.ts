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
