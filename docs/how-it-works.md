# How it works

Knarr copies files. That's basically it. Publish copies your built library into a local store, and add/push copies from the store into `node_modules/`. No symlinks, no package.json rewrites.

```mermaid
graph TB
    subgraph "Library repo"
        A[src/] --> B[dist/]
        A --> |"pnpm build"| B
    end

    subgraph "Knarr store (~/.knarr/)"
        C["store/my-lib@1.0.0/"]
        C --- C1[package/]
        C --- C2[.knarr-meta.json]
    end

    subgraph "Consumer project"
        D[node_modules/my-lib/]
        D --- D1[dist/index.js]
        D --- D2[package.json]
    end

    B -- "knarr publish<br/>(copy built files)" --> C
    C -- "knarr add<br/>(incremental copy)" --> D

    style A fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style B fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style C fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style C1 fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style C2 fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style D fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style D1 fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style D2 fill:#e65100,stroke:#ffb74d,color:#fff3e0
```

## Store

The global store lives at `~/.knarr/` (override with `KNARR_HOME` env var):

```
~/.knarr/
├── store/
│   ├── my-lib@1.0.0/
│   │   ├── package/              # Publishable files (same as npm pack)
│   │   │   ├── dist/index.js
│   │   │   ├── dist/index.d.ts
│   │   │   └── package.json
│   │   └── .knarr-meta.json      # Content hash, timestamp, source path
│   └── @scope+other-lib@2.3.1/   # Scoped: / encoded as +
│       └── ...
└── consumers.json                 # Which projects have linked which packages
```

A few things to note about the store:

- It's mutable, not content-addressed. `my-lib@1.0.0` is overwritten in-place when you re-publish. The content hash in `.knarr-meta.json` is just for skip detection ("has anything changed?").
- Scoped packages encode the `/` as `+` in directory names. `@scope/name` becomes `@scope+name`.
- `consumers.json` tracks which projects have linked which packages, so `knarr push` knows where to copy.

### `.knarr-meta.json`

```json
{
  "schemaVersion": 1,
  "contentHash": "sha256v2:a1b2c3d4...",
  "publishedAt": "2026-02-17T10:30:00.000Z",
  "sourcePath": "/home/user/projects/my-lib",
  "buildId": "a1b2c3d4"
}
```

## What happens during publish

```mermaid
flowchart TD
    A[Read package.json] --> B{Has 'files' field?}
    B -- Yes --> C[Collect listed files]
    B -- No --> D[Collect all files minus defaults]
    C --> E[Apply .npmignore exclusions]
    D --> E
    E --> F[Always include package.json, README, LICENSE]
    F --> G[Compute content hash]
    G --> H{Hash matches store?}
    H -- Yes --> I["Skip (already up to date)"]
    H -- No --> J[Copy files to store]
    J --> K[Rewrite workspace: and catalog: versions]
    K --> L[Write .knarr-meta.json]

    style A fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style B fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style G fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style H fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style I fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style J fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style K fill:#00838f,stroke:#4dd0e1,color:#e0f2f1
    style L fill:#e65100,stroke:#ffb74d,color:#fff3e0
```

File resolution follows `npm pack` rules:
- If `package.json` has a `files` array, only those files/globs are included
- Otherwise, all files minus `.git/`, `node_modules/`, etc.
- `.npmignore` exclusions always apply
- `package.json`, `README*`, `LICENSE*`, `CHANGELOG*` are always included

If a dependency uses `workspace:*` (or `workspace:^`, `workspace:~`), Knarr rewrites it to the actual version in the store copy. The `catalog:` protocol (pnpm's shared version definitions in `pnpm-workspace.yaml`) is also resolved — both `catalog:` (default catalog) and `catalog:<name>` (named catalog) specifiers get replaced with the actual version string. Your source `package.json` is never touched.

When `publishConfig.directory` is set in `package.json`, Knarr reads files from that subdirectory instead of the package root. This matches how npm/pnpm handle `publishConfig.directory` at pack time.

## Injection

knarr checks your lockfile to figure out the package manager, then uses the right copy strategy.

### npm / yarn / bun

Straightforward. Replace files in `node_modules/<pkg>/`:

```mermaid
graph LR
    Store["store/my-lib@1.0/package/"] -- "incremental copy" --> NM["node_modules/my-lib/"]
    NM --- Bin[".bin/my-cli"]

    style Store fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style NM fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style Bin fill:#00838f,stroke:#4dd0e1,color:#e0f2f1
```

Clear the target directory, copy files from the store. The writes generate filesystem events that bundler watchers pick up.

### pnpm

pnpm's `.pnpm/` virtual store makes this trickier. Knarr follows the symlink chain to find the real directory:

```mermaid
graph LR
    NM["node_modules/my-lib"] -- "symlink" --> PNPM[".pnpm/my-lib@1.0/<br/>node_modules/my-lib"]
    Store["store/my-lib@1.0/package/"] -- "incremental copy" --> PNPM

    style Store fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style PNPM fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style NM fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
```

Knarr resolves `node_modules/<pkg>` → follows the symlink into `.pnpm/` → replaces files at the real directory. The top-level symlink is preserved.

### Detection

| Lockfile | Package manager |
|---|---|
| `pnpm-lock.yaml` | pnpm |
| `bun.lockb` or `bun.lock` | bun |
| `yarn.lock` | yarn |
| `package-lock.json` | npm |

Detection checks in priority order (pnpm > bun > yarn > npm). Falls back to npm if no lockfile is found.

#### Yarn Berry `nodeLinker` modes

When yarn is detected, Knarr also reads `.yarnrc.yml` to determine the linker mode:

| `nodeLinker` value | Behavior |
|---|---|
| `node-modules` | Flat `node_modules/` — same as npm, works directly |
| `pnpm` | `.pnpm/` virtual store with symlinks — Knarr follows the symlink chain (same as pnpm) |
| `pnp` | No `node_modules/` — incompatible, Knarr exits with an error |
| *(absent, `.yarnrc.yml` exists)* | Berry defaults to PnP — Knarr exits with an error |
| *(no `.yarnrc.yml`)* | Yarn Classic — flat `node_modules/`, works directly |

## Copies

```mermaid
flowchart TD
    A[copyFile with FICLONE_FORCE] --> B{Reflink supported?}
    B -- Yes --> C["Instant copy-on-write<br/>(APFS, btrfs, ReFS)"]
    B -- No --> D["Plain fs.copyFile<br/>(cached per volume)"]

    E[incrementalCopy] --> F{Size differs?}
    F -- Yes --> A
    F -- No --> G{mtime matches?}
    G -- Yes --> I[Skip]
    G -- No --> H["Hash both files (xxhash)"]
    H --> K{Hash differs?}
    K -- Yes --> A
    K -- No --> I
    E --> J{File removed from source?}
    J -- Yes --> L[Delete from dest]

    style A fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style B fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style C fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style D fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style E fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style F fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style G fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style I fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style K fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style J fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style L fill:#c62828,stroke:#ef5350,color:#ffebee
```

1. Each `copyFile` first probes for CoW reflink support (`COPYFILE_FICLONE_FORCE`) on the target volume. The result is cached per volume root — if reflinks aren't supported (ext4, NTFS), all subsequent copies on that volume go straight to a plain `copyFile` with no wasted syscalls. On APFS (macOS), btrfs (Linux), and ReFS (Windows), the reflink is instant and uses no additional disk space.
2. Before copying, Knarr runs a three-tier check: (a) compare file sizes — different sizes mean different content, copy immediately; (b) compare mtimes — if size and mtime both match, skip without hashing (Knarr preserves source mtime on the destination after each copy, so matching mtime+size guarantees identical content); (c) hash both files using xxHash64 — only reached when size matches but mtime differs. Files over 1 MB use xxHash64 streaming to avoid loading them into memory. Only changed files get copied, and files removed from the source get deleted from the destination. All file comparisons run in parallel, throttled to the CPU core count.
3. Files are written directly to their final path in `node_modules/`, which generates the filesystem events bundler watchers need.

## State

Each consumer project gets a `.knarr/state.json` (gitignored):

```json
{
  "version": "1",
  "links": {
    "my-lib": {
      "version": "1.0.0",
      "contentHash": "sha256v2:abc123...",
      "linkedAt": "2026-02-17T10:30:00Z",
      "sourcePath": "/home/user/my-lib",
      "backupExists": true,
      "packageManager": "npm",
      "buildId": "abc12345"
    }
  }
}
```

Backups live in `.knarr/backups/<pkg>/`. That's the original npm-installed version, which gets restored when you run `knarr remove`.

The global registry at `~/.knarr/consumers.json` maps packages to projects:

```json
{
  "my-lib": ["/home/user/app-1", "/home/user/app-2"],
  "@scope/other-lib": ["/home/user/app-1"]
}
```

This lets `knarr push` know which projects to update.

## Hash strategy

knarr uses two different hash algorithms for different purposes:

| Hash | Algorithm | Where | Why |
|---|---|---|---|
| Per-file | xxHash64 (xxhash-wasm) | Incremental copy — comparing source vs destination files | Fast change detection. ~5-10x faster than SHA-256. Not persisted. |
| Aggregate | SHA-256 | `contentHash` in `.knarr-meta.json` and `state.json` | Content identity across publishes. Deterministic, stable prefix `sha256v2:`. |

The per-file hash is computed on every copy operation to decide which files actually changed. Small files (<=1 MB) are buffered and hashed in one shot. Large files use xxHash64 streaming to avoid loading them into memory.

The aggregate hash is computed once per publish over all files (sorted by path, length-prefixed). It uses SHA-256 because the `sha256v2:` prefix is stored in metadata, and switching algorithms would invalidate every existing store entry for no meaningful speedup.

The `buildId` is the first 8 hex characters of the content hash (after the `sha256v2:` prefix). It appears in logs and state files as a short identifier for each publish.

## Lifecycle hooks

When you run `knarr publish` (or push/dev, which call publish internally), Knarr runs lifecycle scripts from `package.json` in this order:

```
preknarr → prepack → [publish files] → postpack → postknarr
```

- `preknarr` and `postknarr` always run if defined in `scripts`
- `prepack` and `postpack` can be skipped with `--no-scripts`
- Each hook has a 30-second timeout by default. Override with `KNARR_HOOK_TIMEOUT` (milliseconds):
  ```bash
  KNARR_HOOK_TIMEOUT=60000 knarr publish
  ```
- Hooks run in the package directory with `stdio: inherit`, so their output is visible

## Dry-run mode

When you pass `--dry-run` to any command, Knarr skips all filesystem mutations (copies, removes, directory creation, bin links, lock acquisition, lifecycle hooks) but still runs the full logic to determine what _would_ happen. Each skipped mutation is recorded centrally, and at exit Knarr prints a grouped summary:

```
[dry-run] 14 mutation(s) would be performed:

  Copy (8):
    /path/to/store/dist/index.js → /path/to/app/node_modules/my-lib/dist/index.js
    ...
  Create directory (2):
    /path/to/store/my-lib@1.0.0/package
    ...
  Skip lock (1):
    /path/to/store/my-lib@1.0.0
  Skip lifecycle hook (1):
    /path/to/my-lib (prepack: npm run build)
```

With `--json`, the summary is output as structured JSON with all mutation details.

## Atomic publish

Publishing uses a two-phase write to prevent partial state:

1. Files are copied to a temporary directory (`<store-entry>.tmp-<timestamp>`)
2. The temp directory is atomically renamed to the final store path
3. If the store entry already existed, the old copy is renamed aside first, then deleted after the swap succeeds

A file lock (`withFileLock()`, using `mkdir` as an atomic lock primitive) prevents concurrent publishes of the same package from corrupting the store. The lock uses exponential backoff with stale detection — locks older than 60 seconds are considered abandoned and broken.

## Bin links

If a package has a `bin` field in `package.json`, Knarr creates executables in `node_modules/.bin/`: symlinks on Unix, `.cmd` wrappers on Windows. Cleaned up on `knarr remove`.

## Why not symlinks?

See [Comparison](comparison.md) for the full picture, but the short version:

Node.js resolves `require()` from the symlink's *real* path, not the link path. So a library and its consumer can end up with two different copies of React, and you get cryptic runtime errors ("Invalid hook call", `instanceof` returning false). Bundlers like Vite and Turbopack also scope their file watching to the project directory, so a symlink pointing outside doesn't trigger HMR.

pnpm's "injected dependencies" feature already proved that copies work for this. Knarr follows the same idea.

## Why not hardlinks?

Hardlinks sound perfect (instant, zero disk space) but they don't work here:

1. **Breaks incremental copy.** Knarr compares source and destination file hashes to detect changes. Hardlinks share an inode, so modifying the source silently modifies the destination too — the hashes always match, and Knarr never detects that anything changed.
2. **Breaks bundler watchers.** On macOS (FSEvents) and Windows (ReadDirectoryChangesW), modifying a file through one hardlink path does NOT notify watchers on a different path. Bundlers watching `node_modules/` would never see changes made via the store.
3. **Corrupts the store.** When `npm install` removes `node_modules/<pkg>/` containing hardlinks, it deletes the shared inodes. This corrupts the store and breaks every other consumer.
4. **Bundler caching.** Even if hardlinks worked perfectly, bundlers like Vite pre-bundle and cache deps, so they wouldn't re-read the files anyway.
