# FAQ

## Why not symlinks?

By default, Node.js resolves `require()` and `import` from the symlink's **real path**, not the link location. When a library is symlinked from outside the consumer project, its `require('react')` resolves from the library's own `node_modules/`, not the consumer's. This can create two separate instances of React (or any shared dependency), which causes:

- "Invalid hook call" errors in React
- `instanceof` checks returning false
- Context not propagating across module boundaries
- Bundlers like Vite and Turbopack not detecting changes (symlink target is outside the watched project root)

Knarr copies files directly into `node_modules/`, so the library resolves dependencies from the consumer's `node_modules/` tree, just like a real npm-installed package.

See [Comparison](comparison.md) for a detailed side-by-side with native pnpm options, symlink workflows, yalc, and Knarr.

## How does copy-on-write (CoW) work?

When Knarr copies files, it probes each volume for reflink support using `COPYFILE_FICLONE_FORCE`. The result is cached per volume root, so the probe only happens once per process:

- **macOS (APFS):** The copy is instant and uses no additional disk space until one side is modified.
- **Linux (btrfs, XFS with reflink):** Same behavior.
- **Windows (ReFS):** Same behavior.

On filesystems that do not support reflinks (ext4, NTFS), Knarr caches the failure and all subsequent copies on that volume go straight to a plain `copyFile` — no wasted syscalls retrying an unsupported operation.

Knarr also uses incremental copying with a three-tier check: it compares file sizes first (fast reject), then compares mtimes (Knarr preserves source mtime on the destination after each copy, so matching size+mtime guarantees identical content — skip without hashing), and only falls back to hashing both files with xxhash (xxh64, ~10x faster than SHA-256) when sizes match but mtimes differ. Only files whose content changed get copied. Files removed from the source are deleted from the destination. All comparisons run in parallel, throttled to the available CPU core count.

## How is Knarr different from yalc?

The main differences:

1. **Knarr does not add local dependency specs.** The default `yalc add` flow writes a `file:.yalc/my-lib` or `link:` dependency into `package.json`. Knarr keeps the consumer's dependency spec pointed at the normal package version, though setup helpers may still add a restore hook or bundler config.

2. **Different local state.** yalc commonly creates `.yalc/` and `yalc.lock` in the consumer. Knarr uses a global store at `~/.knarr/store/` and a gitignored `.knarr/` directory for consumer state and backups.

3. **pnpm virtual-store injection.** Knarr detects pnpm and follows the `.pnpm/` symlink chain to inject files at the existing package location when possible. Native pnpm `workspace:`, `file:`, and `dependenciesMeta.*.injected` are still better choices when they fit your workspace.

4. **Built-in build/push loop.** yalc has `yalc push` and `yalc publish --push`; Knarr has `knarr dev` and `knarr push --watch --build "cmd"` for rebuilding and pushing to registered consumers continuously.

5. **Incremental copy into consumers.** Knarr compares size, mtime, and xxHash64 where needed, then only copies changed files into each consumer.

6. **Backup and restore.** Knarr backs up the original installed package and restores it on `knarr remove`. `knarr restore` re-injects linked packages after installs replace `node_modules`.

See [Migrating from yalc](migrating-from-yalc.md) for a step-by-step migration guide.

## Does Knarr modify package.json?

Knarr never rewrites dependency version specifiers to local `file:` or `link:` paths. Some setup and repair helpers can edit `package.json`:

- `knarr init` may add a `postinstall` script (`knarr restore --silent || node -e "process.exit(0)"`)
- Vite auto-configuration may install `knarr` as a dev dependency so `knarr/vite` resolves from the consumer project
- Missing dependency prompts may install dependencies if you accept them

The normal Knarr link state lives in gitignored project files:

- `.knarr/state.json` -- tracks which packages are linked
- `.knarr/backups/` -- backup of original installed packages

Knarr does not intentionally edit lockfiles except through package-manager install commands that you approve.

## What about pnpm strict mode?

pnpm's strict mode (the default since pnpm v7) prevents packages from importing dependencies they did not declare. Knarr works with strict mode because:

1. Knarr injects files into the existing `node_modules/<pkg>` directory that pnpm already set up. It does not create new package entries or modify the dependency graph.

2. Knarr follows pnpm's symlink chain: `node_modules/<pkg>` -> `.pnpm/<pkg>@<version>/node_modules/<pkg>`. Files are written at the real path, preserving pnpm's virtual store structure.

3. The library's dependencies are still resolved through pnpm's normal dependency tree. Knarr only replaces the library's own files (source, types, package.json), not its dependencies.

If the library you are developing has a dependency that is not installed in the consumer, Knarr warns you during `knarr add`:

```
warn  my-lib depends on "lodash" which is not installed in this project
```

You need to install it yourself (`pnpm add lodash`), just as you would with a real npm-published version.

## Should I use Knarr in CI?

Usually no. Prefer canary or prerelease packages for CI and release validation
because they go through the registry and the consumer's normal package-manager
install path.

Knarr can still be used for narrow same-checkout smoke tests when publishing a
canary is unavailable, but treat that as a weaker signal. See
[CI/CD: Prefer Canary Builds](ci-cd.md).

## How do I clean up the store?

The global store at `~/.knarr/store/` grows as you publish packages. To clean it up:

```bash
knarr clean
```

This removes:

- **Stale consumer registrations** -- entries in `~/.knarr/consumers.json` pointing to directories that no longer exist.
- **Unreferenced store entries** -- packages in the store that are not linked by any active consumer.

To see what is in the store before cleaning:

```bash
knarr list --store
```

To remove everything and start fresh:

```bash
rm -rf ~/.knarr
```

This deletes the store, the consumers registry, and all metadata. Existing linked packages in `node_modules/` will continue to work (they are real copies), but `knarr restore`, `knarr update`, and `knarr push` will not function until you re-publish.

## Does Knarr work with Yarn PnP?

Yarn PnP (Plug'n'Play) does not use `node_modules/` at all, so Knarr's copy-based approach does not apply. Knarr requires a traditional `node_modules/` layout.

Knarr detects this automatically and exits early with a clear error message:

```
Error: Yarn PnP mode is not compatible with Knarr.

Knarr works by copying files into node_modules/, but PnP eliminates
node_modules/ entirely. To use Knarr with Yarn Berry, add one of these
to .yarnrc.yml:

  nodeLinker: node-modules
  nodeLinker: pnpm

Then run: yarn install
```

If you use Yarn Berry, set the linker mode in `.yarnrc.yml`:

```yaml
nodeLinker: node-modules
# or use Yarn's pnpm linker:
# nodeLinker: pnpm
```

Then run `yarn install` to recreate `node_modules/`.

With `nodeLinker: pnpm`, Knarr follows Yarn's `.store/` symlink chain automatically.

## Can I use Knarr with private packages?

Yes. By default, Knarr skips packages that have `"private": true` in `package.json`. To publish a private package, use the `--private` flag:

```bash
knarr publish --private
```

Typical for internal monorepo packages that aren't published to npm.

## Can I preview changes before running a command?

Yes. Pass `--dry-run` to any command to see what would happen without writing files:

```bash
knarr publish --dry-run
knarr push --dry-run
```

Knarr prints a grouped summary of all mutations it would perform: file copies, removals, directory creation, bin links, lock acquisitions, lifecycle hooks, and skipped commands. With `--json`, the summary is output as structured JSON.

## What happens when I run npm install / pnpm install?

Running `npm install` or `pnpm install` replaces files in `node_modules/`, which overwrites Knarr's injected files. To get them back:

```bash
knarr restore
```

If you ran `knarr init`, this can happen automatically via the `postinstall` hook. The hook runs `knarr restore --silent || node -e "process.exit(0)"`, which re-injects all linked packages when `knarr` is available on the install script `PATH` (for example, installed globally or as a devDependency). The Node fallback ensures the install does not fail if Knarr is not available.
