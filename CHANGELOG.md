# Changelog

## 0.1.3

- Centralize package-manager discovery, compatibility, installation layout, and command behavior behind npm, pnpm, Yarn, and Bun adapters.
- Keep tracked package-manager fallback, Yarn linker diagnostics, and virtual-store resolution consistent across add, init, doctor, update, restore, publish, inject, and push workflows.
- Expand adapter-level coverage for node_modules, pnpm, Yarn pnpm-linker, Yarn PnP, and Bun layouts.

## 0.1.2

- Fix watch mode on WSL Windows-mounted paths by enabling polling where native filesystem events are unreliable.

## 0.1.1

- Clarify README, FAQ, comparison, and yalc migration docs around native package-manager workflows, yalc, and Knarr tradeoffs.
- Recommend canary or prerelease packages for CI and release validation, with Knarr limited to local smoke tests.

## 0.1.0

- Expand package-manager support for Yarn Berry node-modules, Yarn pnpm-linker, Yarn PnP rejection, pnpm virtual stores, and Bun install layouts.
- Run Yarn PnP lifecycle hooks through Yarn and preserve package-manager layout metadata across restore, update, and push.
- Harden injection, doctor, and explain diagnostics against stale or external virtual-store targets.
- Improve publish output for `publishConfig.directory`, workspace aliases, catalog dependencies, `.gitignore` packing, and unchanged rewritten manifests.
- Make watch and dry-run workflows safer, including initial build handling, dry-run watch exits, dependency-aware workspace skips, and cascade failure handling.
- Add compatibility smoke coverage and package-manager-focused regression tests.

## 0.0.3

- Keep auto-installed setup dependencies from pruning freshly linked packages.
- Expose plugin entry points to CommonJS config files used by Webpack and rspack.

## 0.0.2

- Validate package names and versions before deriving store or consumer paths.
- Honor dry-run mode for setup, migration, copy, and install mutations.
- Preserve live store entries when publish or rollback swaps fail.
- Reuse resolved build commands for cascading workspace rebuilds.
- Fix generated Windows `.cmd` bin wrappers to invoke Node.

## 0.0.1

- Initial Knarr release.
