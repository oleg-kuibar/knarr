# API Reference

Everything exported from `knarr` (the `src/index.ts` entry point). Install as a dependency to use programmatically:

```bash
pnpm add knarr
```

```typescript
import { publish, inject, getStoreEntry } from "knarr";
```

## Publishing

### `publish(packageDir, options?)`

Publish a package to the Knarr store.

```typescript
async function publish(
  packageDir: string,
  options?: PublishOptions
): Promise<PublishResult>
```

Reads `package.json`, resolves publishable files, computes a content hash, and copies to the store. Skips if the hash matches the existing store entry (unless `force` is set).

```typescript
const result = await publish("/path/to/my-lib");
if (!result.skipped) {
  console.log(`Published ${result.name}@${result.version} [${result.buildId}]`);
}
```

### `PublishOptions`

```typescript
interface PublishOptions {
  allowPrivate?: boolean;   // allow packages with "private": true
  runScripts?: boolean;     // run prepack/postpack hooks (default: true)
  force?: boolean;          // bypass hash comparison
}
```

### `PublishResult`

```typescript
interface PublishResult {
  name: string;
  version: string;
  fileCount: number;
  skipped: boolean;         // true if content was unchanged
  contentHash: string;      // "sha256v2:..." aggregate hash
  buildId: string;          // 8-char hex identifier
}
```

## Injection

### `inject(storeEntry, consumerPath, pm, options?)`

Copy a package from the store into a consumer's `node_modules/`.

```typescript
async function inject(
  storeEntry: StoreEntry,
  consumerPath: string,
  pm: PackageManager,
  options?: InjectOptions
): Promise<InjectResult>
```

Handles pnpm's `.pnpm/` virtual store by following symlinks. Performs incremental copy — only changed files are written.

```typescript
const entry = await getStoreEntry("my-lib", "1.0.0");
if (entry) {
  await inject(entry, "/path/to/my-app", "pnpm");
}
```

### `backupExisting(consumerPath, packageName, pm)`

Back up the current npm-installed version before overwriting.

```typescript
async function backupExisting(
  consumerPath: string,
  packageName: string,
  pm: PackageManager
): Promise<boolean>  // true if backup was created
```

### `restoreBackup(consumerPath, packageName, pm)`

Restore the backed-up version to `node_modules/`.

```typescript
async function restoreBackup(
  consumerPath: string,
  packageName: string,
  pm: PackageManager
): Promise<boolean>  // true if backup was restored
```

### `removeInjected(consumerPath, packageName, pm)`

Remove an injected package from `node_modules/` and its bin links.

```typescript
async function removeInjected(
  consumerPath: string,
  packageName: string,
  pm: PackageManager
): Promise<void>
```

### `InjectOptions`

```typescript
interface InjectOptions {
  force?: boolean;       // force copy all files, bypassing hash comparison
}
```

### `InjectResult`

```typescript
interface InjectResult {
  copied: number;        // files that were copied
  removed: number;       // files that were removed
  skipped: number;       // files that were unchanged
  binLinks: number;      // bin links created
}
```

### `checkMissingDeps(storeEntry, consumerPath)`

Check whether the consumer is missing any transitive dependencies.

```typescript
async function checkMissingDeps(
  storeEntry: StoreEntry,
  consumerPath: string
): Promise<string[]>  // array of missing package names
```

## Push

### `doPush(packageDir, options?)`

Publish a package to the store, then inject into all registered consumers. Used internally by both `push` and `dev` commands.

```typescript
async function doPush(
  packageDir: string,
  options?: PushOptions
): Promise<void>
```

### `PushOptions`

```typescript
interface PushOptions {
  runScripts?: boolean;  // run prepack/postpack hooks (default: true)
  force?: boolean;       // force copy all files, bypassing hash comparison
}
```

## Store

### `getStoreEntry(name, version)`

Get a store entry by name and version. Returns `null` if not found.

```typescript
async function getStoreEntry(
  name: string,
  version: string
): Promise<StoreEntry | null>
```

```typescript
const entry = await getStoreEntry("my-lib", "1.0.0");
if (entry) {
  console.log(entry.meta.contentHash);
  console.log(entry.packageDir); // path to package/ dir in store
}
```

### `findStoreEntry(name)`

Find a store entry by name (any version). Returns the most recently published version.

```typescript
async function findStoreEntry(
  name: string
): Promise<StoreEntry | null>
```

### `listStoreEntries()`

List all entries in the store.

```typescript
async function listStoreEntries(): Promise<StoreEntry[]>
```

## Tracking

### `readConsumerState(consumerPath)`

Read the consumer state file (`.knarr/state.json`). Returns empty state if the file doesn't exist.

```typescript
async function readConsumerState(
  consumerPath: string
): Promise<ConsumerState>
```

### `readConsumerStateSafe(consumerPath)`

Like `readConsumerState`, but returns `null` instead of empty state if the file doesn't exist.

```typescript
async function readConsumerStateSafe(
  consumerPath: string
): Promise<ConsumerState | null>
```

### `getLink(consumerPath, packageName)`

Get a single link entry from the consumer state. Returns `null` if the package is not linked.

```typescript
async function getLink(
  consumerPath: string,
  packageName: string
): Promise<LinkEntry | null>
```

### `addLink(consumerPath, packageName, entry)`

Add or update a link entry in the consumer state.

```typescript
async function addLink(
  consumerPath: string,
  packageName: string,
  entry: LinkEntry
): Promise<void>
```

### `removeLink(consumerPath, packageName)`

Remove a link entry from the consumer state.

```typescript
async function removeLink(
  consumerPath: string,
  packageName: string
): Promise<void>
```

### `getConsumers(packageName)`

Get all registered consumer paths for a package.

```typescript
async function getConsumers(
  packageName: string
): Promise<string[]>
```

### `registerConsumer(packageName, consumerPath)`

Register a consumer in the global registry (`~/.knarr/consumers.json`).

```typescript
async function registerConsumer(
  packageName: string,
  consumerPath: string
): Promise<void>
```

### `unregisterConsumer(packageName, consumerPath)`

Remove a consumer from the global registry.

```typescript
async function unregisterConsumer(
  packageName: string,
  consumerPath: string
): Promise<void>
```

### `cleanStaleConsumers()`

Remove registrations for consumer directories that no longer exist on disk.

```typescript
async function cleanStaleConsumers(): Promise<{
  removedConsumers: number;
  removedPackages: number;
}>
```

## Watching

### `startWatcher(watchDir, options, onChange)`

Start watching a directory for file changes and trigger a callback.

```typescript
async function startWatcher(
  watchDir: string,
  options: WatchOptions,
  onChange: () => Promise<void>
): Promise<{ close: () => Promise<void> }>
```

Uses chokidar. Implements debounce-effects strategy: changes are detected immediately but coalesced before triggering the callback. If new changes arrive during callback execution, re-triggers after it finishes.

### `runBuildCommand(buildCmd, cwd)`

Run a build command as a subprocess and wait for it to complete.

```typescript
async function runBuildCommand(
  buildCmd: string,
  cwd: string
): Promise<boolean>  // true if exit code 0
```

### `killActiveBuild()`

Kill the active build subprocess if one is running.

```typescript
function killActiveBuild(): void
```

## Batch Push

### `doPushAll(startDir, options?)`

Push all workspace packages in topological (dependency-first) order. Discovers workspace packages, sorts by dependency graph, and pushes sequentially.

```typescript
async function doPushAll(
  startDir: string,
  options?: PushOptions
): Promise<void>
```

```typescript
await doPushAll("/path/to/monorepo");
```

## Watch Orchestrator

### `WatchOrchestrator`

Orchestrates watch mode for all workspace packages with cascading rebuilds. When a package is pushed, its dependents in the workspace are automatically rebuilt and pushed.

```typescript
class WatchOrchestrator {
  constructor(cascade: boolean)
  start(startDir: string, args: WatchArgs, pushOptions: PushOptions): Promise<void>
  close(): Promise<void>
}
```

The orchestrator uses a state machine per package (idle/building/queued) to prevent infinite rebuild loops.

```typescript
const orchestrator = new WatchOrchestrator(true); // cascade enabled
await orchestrator.start("/path/to/monorepo", watchArgs, pushOptions);
```

## Build History

### `captureHistory(name, version, oldEntryDir, historyLimit?)`

Capture the current store entry as a history entry before it gets replaced.

```typescript
async function captureHistory(
  name: string,
  version: string,
  oldEntryDir: string,
  historyLimit?: number
): Promise<void>
```

### `listHistory(name, version)`

List all history entries for a package, sorted by publishedAt (newest first).

```typescript
async function listHistory(
  name: string,
  version: string
): Promise<HistoryEntry[]>
```

### `getHistoryEntry(name, version, buildId)`

Get a specific history entry by buildId.

```typescript
async function getHistoryEntry(
  name: string,
  version: string,
  buildId: string
): Promise<HistoryEntry | null>
```

### `restoreHistoryEntry(name, version, buildId, historyLimit?)`

Restore a history entry as the current store entry.

```typescript
async function restoreHistoryEntry(
  name: string,
  version: string,
  buildId: string,
  historyLimit?: number
): Promise<HistoryEntry | null>
```

### `pruneHistory(name, version, limit)`

Prune history entries to keep only the most recent `limit` entries.

```typescript
async function pruneHistory(
  name: string,
  version: string,
  limit: number
): Promise<number>  // number of entries removed
```

### `clearHistory(name, version)`

Remove all history for a package.

```typescript
async function clearHistory(
  name: string,
  version: string
): Promise<void>
```

### `resolveHistoryLimit(configValue?)`

Resolve the effective history limit from config or default (3).

```typescript
function resolveHistoryLimit(configValue?: number): number
```

## Pre-flight Checks

### `runPreflightChecks(packageDir)`

Run pre-flight validation checks on a package before publishing. Checks entry points, exports, types, and bin paths exist on disk.

```typescript
async function runPreflightChecks(
  packageDir: string
): Promise<PreflightIssue[]>
```

```typescript
const issues = await runPreflightChecks("/path/to/my-lib");
for (const issue of issues) {
  console.log(`[${issue.severity}] ${issue.code}: ${issue.message}`);
}
```

## Dry-Run

### `recordMutation(mutation)`

Record a mutation that was skipped due to `--dry-run`.

```typescript
function recordMutation(mutation: DryRunMutation): void
```

### `printDryRunReport()`

Print a grouped summary of all recorded dry-run mutations. Outputs JSON when `--json` is active.

```typescript
function printDryRunReport(): void
```

### `resetMutations()`

Reset recorded mutations (for testing).

```typescript
function resetMutations(): void
```

## Workspace

### `buildWorkspaceGraph(startDir)`

Discover workspace packages and build a dependency graph.

```typescript
async function buildWorkspaceGraph(
  startDir: string
): Promise<WorkspaceGraph>
```

### `buildReverseAdjacency(adjacency)`

Build a reverse adjacency map from a dependency graph. Maps each package to the set of packages that depend on it.

```typescript
function buildReverseAdjacency(
  adjacency: Map<string, Set<string>>
): Map<string, Set<string>>
```

### `topoSort(graph)`

Topological sort using Kahn's algorithm. Returns nodes in dependency-first order.

```typescript
function topoSort(
  graph: Map<string, Set<string>>
): string[]  // throws CycleError if cycle detected
```

### `CycleError`

Error thrown when a dependency cycle is detected during topological sort.

```typescript
class CycleError extends Error {
  readonly cycle: string[];
}
```

## Config

### `loadKnarrConfig(projectDir)`

Load Knarr configuration from `package.json#knarr`.

```typescript
async function loadKnarrConfig(
  projectDir: string
): Promise<KnarrConfig>
```

### `isComplexConfig(content)`

Heuristic to detect configs that are too complex for automatic rewriting. Used by Vite and Next.js config rewriters.

```typescript
function isComplexConfig(
  content: string
): { complex: boolean; reason?: string }
```

## Utilities

### `detectPackageManager(projectDir)`

Detect the package manager by walking up the filesystem looking for lockfiles.

```typescript
async function detectPackageManager(
  projectDir: string
): Promise<PackageManager>  // "npm" | "pnpm" | "yarn" | "bun"
```

Priority order: pnpm > bun > yarn > npm. Falls back to npm if no lockfile is found.

### `Timer`

Simple elapsed-time tracker.

```typescript
class Timer {
  elapsedMs(): number    // milliseconds since creation
  elapsed(): string      // human-readable ("1.2s" or "150ms")
}
```

### `isNodeError(err)`

Type guard for Node.js system errors.

```typescript
function isNodeError(err: unknown): err is NodeJS.ErrnoException
```

## Types

All types from `src/types.ts` are re-exported:

```typescript
interface KnarrMeta {
  schemaVersion?: number;
  contentHash: string;
  publishedAt: string;
  sourcePath: string;
  buildId?: string;          // 8-char hex ID; missing in pre-buildId store entries
}

interface StoreEntry {
  name: string;
  version: string;
  packageDir: string;
  meta: KnarrMeta;
}

interface LinkEntry {
  version: string;
  contentHash: string;
  linkedAt: string;
  sourcePath: string;
  backupExists: boolean;
  packageManager: PackageManager;
  buildId?: string;          // 8-char hex ID; missing in pre-buildId state files
}

interface ConsumerState {
  version: "1";
  packageManager?: PackageManager;
  role?: "consumer" | "library";
  links: Record<string, LinkEntry>;
}

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface WatchOptions {
  patterns?: string[];
  buildCmd?: string;
  debounce?: number;         // debounce delay in ms (default: 500)
  cooldown?: number;         // minimum time between builds in ms (default: 500)
  awaitWriteFinish?: boolean | { stabilityThreshold: number; pollInterval: number };
}

interface HistoryEntry {
  buildId: string;
  contentHash: string;
  publishedAt: string;
  sourcePath: string;
  packageDir: string;         // path to package/ dir in history
}

interface PreflightIssue {
  code: string;
  severity: "warn" | "error";
  message: string;
}

type MutationType = "copy" | "remove" | "move" | "mkdir" | "write"
  | "bin-link" | "bin-unlink" | "cache-invalidate" | "lock-skip" | "lifecycle-skip";

interface DryRunMutation {
  type: MutationType;
  path: string;
  dest?: string;
  detail?: string;
}

interface KnarrConfig {
  buildCmd?: string;
  watchPatterns?: string[];
  debounce?: number;
  cooldown?: number;
  historyLimit?: number;      // max historical builds (default: 3)
  notify?: boolean;           // terminal bell on push
}

interface WorkspacePackage {
  name: string;
  version: string;
  dir: string;
  pkg: PackageJson;
}

interface WorkspaceGraph {
  packages: WorkspacePackage[];
  adjacency: Map<string, Set<string>>;  // package name → dependency names
}

interface ConsumersRegistry {
  /** Maps package name to array of consumer project paths */
  [packageName: string]: string[];
}

interface PackageJson {
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
```
