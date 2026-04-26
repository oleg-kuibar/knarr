# Monorepo and multi-consumer setup

Knarr works with monorepos and multi-project setups where a library is consumed by several apps.

## How Knarr handles multiple consumers

When you run `knarr add my-lib` in different projects, each one is registered in the global consumers registry at `~/.knarr/consumers.json`:

```json
{
  "my-lib": [
    "/home/user/projects/app-1",
    "/home/user/projects/app-2",
    "/home/user/projects/app-3"
  ]
}
```

When you run `knarr push` from the library directory, knarr publishes to the store once and then copies changed files into every registered consumer in parallel (up to 4 concurrent injections).

```
my-lib/
  knarr push
    -> publish to store (once)
    -> inject into app-1/node_modules/my-lib/
    -> inject into app-2/node_modules/my-lib/
    -> inject into app-3/node_modules/my-lib/
```

Each consumer gets its own backup, state tracking, and content hash. Consumers can even be on different package managers.

## pnpm workspaces with Knarr

In a pnpm workspace, internal packages are typically linked via `workspace:*` protocol. Knarr is useful when you want to test a package as it would appear after publishing to npm -- with built output, resolved workspace versions, and the `files` field applied -- rather than using the raw source link.

### Setup

```
monorepo/
  packages/
    my-lib/           # the library you're developing
  apps/
    web-app/          # consumer app
    mobile-app/       # another consumer
  pnpm-workspace.yaml
```

```bash
# Build and publish the library
cd packages/my-lib
pnpm build
knarr publish

# Set up each consumer
cd ../../apps/web-app
knarr init -y
knarr add my-lib

cd ../mobile-app
knarr init -y
knarr add my-lib
```

Now `knarr push` from `packages/my-lib/` will update both apps.

### workspace:* protocol

When knarr publishes a package, it rewrites `workspace:*`, `workspace:^`, and `workspace:~` version specifiers to the actual resolved versions in the store copy. Your source `package.json` is never modified.

For example, if `my-lib/package.json` has:

```json
{
  "dependencies": {
    "shared-utils": "workspace:^"
  }
}
```

And `shared-utils` is version `2.1.0`, the store copy will have:

```json
{
  "dependencies": {
    "shared-utils": "^2.1.0"
  }
}
```

This means the injected version in `node_modules/` behaves like a real published package.

## Watch mode with multiple consumers

Use `knarr dev` to continuously push changes to all consumers as you edit:

```bash
cd packages/my-lib
knarr dev
```

`knarr dev` auto-detects the build command from `package.json` scripts. For explicit control, use `knarr push --watch --build "pnpm build"`.

The flow is:

1. Source file changes detected immediately
2. Coalesce window (default 500ms, configurable via `--debounce`)
3. Build command runs (`pnpm build`)
4. Publish to store (skipped if content hash unchanged)
5. Copy changed files to all registered consumers
6. Each consumer's bundler detects the `node_modules/` change and triggers HMR
7. If changes arrived during steps 3-5, automatically re-runs

In a separate terminal, run your consumer's dev server:

```bash
cd apps/web-app
pnpm dev
```

If a build fails, Knarr logs the error and keeps watching. Fix the code and save again.

### Coalesce tuning

For large builds, increase the coalesce window to avoid redundant rebuilds while you are making rapid edits:

```bash
knarr dev --debounce 500
```

## Multiple libraries

### Workspace-wide watch (`--all`)

When developing multiple libraries at once, use `knarr dev --all` to watch the entire workspace from any package directory:

```bash
# Terminal 1: watch all workspace packages
cd packages/my-lib    # or any workspace package
knarr dev --all

# Terminal 2: run your app
cd apps/web-app
pnpm dev
```

`knarr dev --all` discovers all workspace packages, sorts them by dependency order, and starts a watcher for each. When a package changes, it rebuilds and pushes to all consumers.

### Cascading rebuilds

With `--all`, cascading rebuilds are enabled by default. When package A is pushed, any workspace packages that depend on A are automatically rebuilt and pushed too.

```
shared-utils changes → build + push shared-utils
  → my-lib depends on shared-utils → rebuild + push my-lib
  → ui-kit depends on my-lib → rebuild + push ui-kit
```

A state machine per package (idle/building/queued) prevents infinite rebuild loops. If new changes arrive while a package is building, they are coalesced into a single rebuild after the current one finishes.

To disable cascading and watch packages independently:

```bash
knarr dev --all --no-cascade
```

### Separate terminals

Alternatively, you can run `knarr dev` for each library in its own terminal:

```bash
# Terminal 1
cd packages/my-lib
knarr dev

# Terminal 2
cd packages/shared-utils
knarr dev

# Terminal 3
cd apps/web-app
pnpm dev
```

Each library tracks its own consumers independently. This approach gives you more control but doesn't automatically cascade rebuilds across workspace packages.

## Tips for monorepo setups

### Initialize all consumers at once

```bash
for app in apps/*/; do
  (cd "$app" && knarr init -y)
done
```

### Link a library to all consumers

```bash
cd packages/my-lib
pnpm build
knarr publish

for app in apps/*/; do
  (cd "$app" && knarr add my-lib)
done
```

### Check status across consumers

From any consumer:

```bash
knarr status
knarr doctor
```

### After pnpm install

Running `pnpm install` in a workspace can wipe `node_modules/` overrides. If `knarr init` was run in each consumer, the `postinstall` hook (`knarr restore || true`) will re-inject automatically.

If you need to re-inject manually:

```bash
for app in apps/*/; do
  (cd "$app" && knarr restore)
done
```

### Clean up stale state

When you remove a consumer project or stop using Knarr in one, the global registry may still reference it. Run:

```bash
knarr clean
```

This removes stale consumer registrations (directories that no longer exist) and unreferenced store entries.

## Mixing Knarr with workspace protocol

Knarr and pnpm workspace links can coexist. You might use `workspace:*` for packages that are consumed as raw source (with shared `tsconfig` paths), and Knarr for packages you want to test as published builds.

The general rule: if you want to test the "npm publish" output of a package locally, use Knarr. If you want live source links with your bundler handling the transpilation, use the regular workspace protocol.
