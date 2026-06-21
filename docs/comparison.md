# Comparing local package workflows

Knarr is not a replacement for every local package workflow. Use the native
package-manager feature when it already matches what you need. Use Knarr when
you specifically want to test the publishable package output inside a consumer
project without changing that consumer's dependency spec to a local path.

## Short version

| Workflow | Best fit | Tradeoff |
| --- | --- | --- |
| pnpm `workspace:` | Packages live in one pnpm workspace and consumers can use source links | Requires a workspace and dependency specs intentionally point at local workspace packages |
| pnpm `file:` | Local package path should be hard-linked and dependencies installed by pnpm | Writes a local path into the manifest and lockfile |
| pnpm `dependenciesMeta.*.injected` | Workspace package needs per-consumer peer dependency resolution | Copies must be refreshed after source changes, usually by install/build tooling |
| `npm link` / `pnpm link` | Quick manual test where symlinks are acceptable | Symlink behavior can expose duplicate dependency or bundler-watch issues |
| yalc | Local repository workflow with publish/add/push commands | Default `yalc add` creates `.yalc`, `yalc.lock`, and a `file:` or `link:` dependency |
| Knarr | Test built/publishable package files in real consumers while keeping normal dependency specs | Not package-manager-native; installs can overwrite injected files until `knarr restore` runs |

## Native options first

### pnpm workspaces

If the library and app live in the same pnpm workspace, start with
`workspace:`. pnpm guarantees that `workspace:` dependencies resolve only to
local workspace packages, and rewrites those specs to normal versions during
`pnpm pack` or `pnpm publish`.

Use this when the consumer can run against workspace source or your existing
build pipeline already compiles the dependency for the app.

### pnpm `file:` and `pnpm link`

pnpm documents an important difference:

- `pnpm link <dir>` symlinks the source package. Changes are reflected, but
  dependencies of the linked package are not installed for you.
- `file:` hard-links the package into `node_modules` and pnpm installs the
  package's dependencies. pnpm recommends `file:` when peer dependency behavior
  matters.

These are good native choices when you are comfortable committing or locally
maintaining a local path spec in `package.json` and the lockfile.

### pnpm injected workspace dependencies

`dependenciesMeta.*.injected` tells pnpm to install a local workspace package as
a hard-linked copy in `node_modules/.pnpm` instead of the default symlink to the
source directory. pnpm calls out the peer dependency benefit: different
consumers can resolve the same workspace package against different peer
versions.

The catch is update flow. pnpm's docs note that injected copies must be updated
when the source changes, and suggest rerunning install or using helper tools for
more robust watch behavior. If that fits your monorepo, prefer it over Knarr.

### pnpm overrides

`overrides` can replace dependencies across the graph from the workspace root.
It is useful for forcing a version, testing a fork, or removing an unwanted
transitive dependency. It is less like a day-to-day watch workflow: it is a
resolution rule, changes project configuration, and normally requires install
steps to materialize the replacement.

## yalc

yalc is closest to Knarr conceptually: it publishes package contents to a local
store and can push updates to projects that installed that local copy.

The default `yalc add my-package` flow copies the package into the consumer's
`.yalc` folder, adds a `file:.yalc/my-package` dependency to `package.json`, and
tracks it in `yalc.lock`. That is explicit and reproducible, but it shows up as
project state. yalc also has alternatives:

- `yalc link my-package` creates a symlink from `.yalc` into `node_modules` and
  does not modify `package.json`.
- `yalc add --pure` avoids touching `package.json` and `node_modules`, which is
  useful for workspace-style setups.
- `yalc publish --push` and `yalc push` publish and propagate updates.

Use yalc when you like the local-repository model and are happy to manage
`.yalc`, `yalc.lock`, and any manifest changes as part of your workflow.

## npm link and pnpm link

`npm link` is a two-step symlink workflow: first a package is linked into the
global npm prefix, then that global link is linked into the consumer's
`node_modules`. npm does not save linked dependencies to `package.json` by
default.

`pnpm link` similarly symlinks to source. It is handy for fast manual testing,
especially when the linked package uses a different package manager, but pnpm
does not install that package's dependencies for you.

Symlinks are fine for many backend and CLI packages. They are weaker for frontend
libraries with peer dependencies or bundlers that treat files outside the
project root differently.

## Knarr

Knarr publishes the files that should be package contents into
`~/.knarr/store/<name>@<version>/package/`, then copies them into registered
consumers' `node_modules`. The consumer keeps its normal dependency spec; Knarr
tracks local state in `.knarr/state.json` and the global consumers registry.

This is useful when:

- The package and consumer are in different repos, or you do not want a local
  `file:`/`link:` spec in the consumer.
- You want to test built output, `files`, `publishConfig.directory`,
  `workspace:`, and `catalog:` rewriting as they would appear in a package.
- You want one command (`knarr dev`) to rebuild, publish, and push changed files
  to every registered consumer.
- You need a restore step after installs replace `node_modules`.

Knarr is not the right tool when Yarn PnP is required, when a native pnpm
workspace link already gives you the desired behavior, or when the consumer
should commit the local dependency path for repeatability.

## Sources

- [yalc README](https://github.com/wclr/yalc)
- [pnpm workspace protocol](https://pnpm.io/workspaces#workspace-protocol-workspace)
- [pnpm `dependenciesMeta.*.injected`](https://pnpm.io/package_json#dependenciesmetainjected)
- [pnpm link vs `file:`](https://pnpm.io/cli/link#whats-the-difference-between-pnpm-link-and-using-the-file-protocol)
- [pnpm overrides](https://pnpm.io/settings#overrides)
- [npm link](https://docs.npmjs.com/cli/v11/commands/npm-link/)
