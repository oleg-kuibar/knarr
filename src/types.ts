/** Metadata stored alongside each package in the Knarr store */
export interface KnarrMeta {
  schemaVersion?: number;
  contentHash: string;
  publishedAt: string;
  sourcePath: string;
  /** 8-char hex ID derived from content hash. Missing in pre-buildId store entries. */
  buildId?: string;
}

/** @deprecated Use KnarrMeta. */
export type KNARRMeta = KnarrMeta;

/** A store entry representing a published package */
export interface StoreEntry {
  name: string;
  version: string;
  packageDir: string; // path to package/ dir in store
  meta: KnarrMeta;
}

/** Tracks a single linked package in a consumer project */
export interface LinkEntry {
  version: string;
  contentHash: string;
  linkedAt: string;
  sourcePath: string;
  backupExists: boolean;
  packageManager: PackageManager;
  /** 8-char hex ID. Missing in pre-buildId state files. */
  buildId?: string;
}

/** Consumer project state file (.knarr/state.json) */
export interface ConsumerState {
  version: "1";
  packageManager?: PackageManager;
  role?: "consumer" | "library";
  links: Record<string, LinkEntry>;
}

/** Global consumers registry (~/.knarr/consumers.json) */
export interface ConsumersRegistry {
  /** Maps package name → array of consumer project paths */
  [packageName: string]: string[];
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** A historical build stored in the store's history directory */
export interface HistoryEntry {
  buildId: string;
  contentHash: string;
  publishedAt: string;
  sourcePath: string;
  /** Path to the history entry's package directory */
  packageDir: string;
}

/** Options for the watch mode */
export interface WatchOptions {
  /** Glob patterns to watch (default: src, lib, dist) */
  patterns?: string[];
  /** Build command to run before publishing */
  buildCmd?: string;
  /** Debounce delay in ms (default: 500) */
  debounce?: number;
  /** Minimum time between builds in ms (default: 500) */
  cooldown?: number;
  /** Ring terminal bell on push success/failure */
  notify?: boolean;
  /** Enable awaitWriteFinish for large/slow writes (auto-enabled when no buildCmd) */
  awaitWriteFinish?:
    | boolean
    | { stabilityThreshold: number; pollInterval: number };
}

/** Package.json fields we care about */
export interface PackageJson {
  name: string;
  version: string;
  files?: string[];
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  main?: string;
  module?: string;
  exports?: unknown;
  type?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  types?: string;
  typings?: string;
  browser?: string | Record<string, string>;
  /** Corepack packageManager field, e.g. "pnpm@9.0.0" */
  packageManager?: string;
  publishConfig?: {
    main?: string;
    module?: string;
    exports?: unknown;
    types?: string;
    typings?: string;
    browser?: string | Record<string, string>;
    bin?: string | Record<string, string>;
    directory?: string;
  };
}
