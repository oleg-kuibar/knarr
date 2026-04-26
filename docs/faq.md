# FAQ

## Why not symlinks?

Node.js resolves `require()` and `import` from the symlink's **real path**, not the link location. When a library is symlinked from outside the consumer project, its `require('react')` resolves from the library's own `node_modules/`, not the consumer's. This creates two separate instances of React (or any shared dependency), which causes:

- "Invalid hook call" errors in React
- `instanceof` checks returning false
- Context not propagating across module boundaries
- Bundlers like Vite and Turbopack not detecting changes (symlink target is outside the watched project root)

Knarr copies files directly into `node_modules/`, so the library resolves dependencies from the consumer's `node_modules/` tree, just like a real npm-installed package.

See [Comparison](comparison.md) for a detailed side-by-side with `npm link` and yalc.

## How does copy-on-write (CoW) work?

When Knarr copies files, it probes each volume for reflink support using `COPYFILE_FICLONE_FORCE`. The result is cached per volume root, so the probe only happens once per process:

- **macOS (APFS):** The copy is instant and uses no additional disk space until one side is modified.
- **Linux (btrfs, XFS with reflink):** Same behavior.
- **Windows (ReFS):** Same behavior.

On filesystems that do not support reflinks (ext4, NTFS), Knarr caches the failure and all subsequent copies on that volume go straight to a plain `copyFile` — no wasted syscalls retrying an unsupported operation.

Knarr also uses incremental copying with a three-tier check: it compares file sizes first (fast reject), then compares mtimes (Knarr preserves source mtime on the destination after each copy, so matching size+mtime guarantees identical content — skip without hashing), and only falls back to hashing both files with xxhash (xxh64, ~10x faster than SHA-256) when sizes match but mtimes differ. Only files whose content changed get copied. Files removed from the source are deleted from the destination. All comparisons run in parallel, throttled to the available CPU core count.

## How is Knarr different from yalc?

The main differences:

1. **Knarr never modifies package.json.** yalc rewrites dependency versions to `file:.yalc/my-lib`, which shows up in git diffs and can leak into CI or npm publishes. Knarr keeps `package.json` clean.

2. **Knarr never creates project-level store directories.** yalc creates a `.yalc/` directory with package copies inside your project. knarr uses a single global store at `~/.knarr/store/` and only creates a gitignored `.knarr/` directory for state tracking.

3. **pnpm support.** yalc has been broken with pnpm since v7.10. Knarr detects pnpm and follows the `.pnpm/` symlink chain to inject files at the correct location.

4. **Built-in watch mode.** yalc relies on the unmaintained `yalc-watch` package. Knarr has `knarr dev` (auto-detects build command) and `knarr push --watch --build "cmd"` built in.

5. **Incremental copy.** yalc copies all files every time. Knarr hashes files with xxhash (parallel, ~10x faster than SHA-256) and only copies what changed.

6. **Backup and restore.** Knarr backs up the original npm-installed version and restores it on `knarr remove`. yalc does not.

See [Migrating from yalc](migrating-from-yalc.md) for a step-by-step migration guide.

## Does Knarr modify package.json?

No. Knarr never modifies the consumer's `package.json` or lockfile. The only project-level artifacts are:

- `.knarr/state.json` -- tracks which packages are linked (gitignored)
- `.knarr/backups/` -- backup of original npm-installed packages (gitignored)
- A `postinstall` script entry (`knarr restore || true`) added by `knarr init`

The `postinstall` script is the only change to `package.json`, and it is opt-in via `knarr init`. It does not affect dependency resolution or version specifiers.

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

## Can I use Knarr in CI?

Yes. See [CI/CD Guide](ci-cd.md) for details. The short version:

1. Set `KNARR_HOME` to an isolated temp directory per job.
2. Use `--json` for machine-readable output.
3. Use `--dry-run` for validation steps.
4. Use `npx knarr` -- no global install required.

```bash
export KNARR_HOME=$(mktemp -d)
npx knarr publish packages/my-lib
cd apps/my-app && npx knarr init -y && npx knarr add my-lib
pnpm test
```

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
node_modules/ entirely. To use Knarr with Yarn Berry, add this to
.yarnrc.yml:

  nodeLinker: node-modules

Then run: yarn install
```

If you use Yarn Berry, set the linker mode in `.yarnrc.yml`:

```yaml
nodeLinker: node-modules
```

Then run `yarn install` to recreate `node_modules/`.

Note: Yarn Berry's `nodeLinker: pnpm` mode (symlink-based virtual store, same layout as pnpm) is also supported. Knarr detects this and follows the `.pnpm/` symlink chain automatically.

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

Knarr prints a grouped summary of all mutations it would perform: file copies, removals, directory creation, bin links, lock acquisitions, and lifecycle hooks. With `--json`, the summary is output as structured JSON.

## What happens when I run npm install / pnpm install?

Running `npm install` or `pnpm install` replaces files in `node_modules/`, which overwrites Knarr's injected files. To get them back:

```bash
knarr restore
```

If you ran `knarr init`, this happens automatically via the `postinstall` hook. The hook runs `knarr restore || true`, which re-injects all linked packages. The `|| true` ensures the install does not fail if Knarr is not globally available.
