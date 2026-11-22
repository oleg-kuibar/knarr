# Knarr

Knarr lets a developer test a local npm package inside another project exactly as it would be installed, by copying the package's publishable files instead of symlinking them.

## Packages and projects

**Package**:
The npm package under development whose files Knarr copies. In a role context it is the library side.
_Avoid_: lib, source package, linked library

**Package source**:
The directory holding a package's own `package.json`, which Knarr publishes from.
_Avoid_: source path (except as the field name), library repo

**Consumer**:
A project that has one or more packages linked into its `node_modules/`.
_Avoid_: app, host project, target project, consuming project

**Role**:
Whether a project is set up as a consumer or as a library (the package side).

**Workspace**:
A pnpm workspace containing several packages, rooted at the nearest `pnpm-workspace.yaml`.
_Avoid_: monorepo (fine in prose, not as the term)

**Catalog**:
A named set of shared dependency versions defined in `pnpm-workspace.yaml` and referenced with `catalog:`.

## The store

**Store**:
The per-machine Knarr cache of published packages, under `KNARR_HOME`.
_Avoid_: global store, cache, registry. Never use bare "store" for a package manager's store; say virtual store.

**Store entry**:
The one mutable slot in the store for a given package name and version, holding the current build.
_Avoid_: store package, published copy

**Build**:
One published snapshot of a package's files, identified by its build ID. A store entry holds the current build; older builds become history entries.
_Avoid_: version (a version is the package.json version; many builds share one version)

**Build ID**:
The short identifier of a build, derived from its content hash.

**Content hash**:
The fingerprint of a build's whole file set, used to tell whether anything changed.

**History entry**:
A previous build kept beside its store entry so it can be rolled back to.
_Avoid_: backup, snapshot

## Operations

**Publish**:
Turn a package source into a new build in its store entry.
_Avoid_: pack, build (building is the user's build command, which runs before publish)

**Inject**:
Copy a build's files from the store entry into a consumer's injection target.
_Avoid_: install, sync, link (link is the resulting record, not the copy)

**Add**:
The consumer-side command that injects a package from the store and records a link. **Use** is add preceded by a publish from a package source.

**Push**:
Publish, then inject into every registered consumer of that package.
_Avoid_: deploy, sync

**Dev**:
Watch mode for push: rebuild and push on every change.
_Avoid_: watch (as a noun for the command)

**Cascade**:
In a workspace, rebuilding and pushing the packages that depend on a package after it is pushed.

**Rollback**:
Make a history entry the current build again.
_Avoid_: restore

**Restore**:
Re-inject every linked package into a consumer after the package manager overwrote them.
_Avoid_: using "restore" for rollback or for putting a backup back

**Remove**:
Unlink a package from a consumer and put its backup back.

## Consumer-side records

**Link**:
The record that a consumer has a given package injected from the store, with the build it last received.
_Avoid_: symlink (Knarr creates no package symlinks), injection

**Consumer state**:
A consumer's own record of its links.
_Avoid_: tracker (that is the module name), lock

**Consumers registry**:
The per-machine map from package name to the consumers that link it, used by push.
_Avoid_: consumer list, tracker

**Backup**:
The package-manager-installed copy of a package, saved before the first inject and put back on remove.
_Avoid_: history entry, original (fine in prose)

**Restore hook**:
The consumer's `postinstall` entry that runs restore after every install.
_Avoid_: postinstall script (ambiguous with the user's own)

## Package-manager layout

**Injection target**:
The real directory in a consumer where a package's files are written.
_Avoid_: destination, install dir

**Virtual store**:
A package manager's own content directory that `node_modules/<pkg>` points into (pnpm `.pnpm/`, Yarn `.store/`, Bun `.bun/`).
_Avoid_: store (reserved for the Knarr store)

## Relationships

- A **package** has one **store entry** per version; a store entry holds one current **build** and up to the history limit of **history entries**.
- A **consumer** has one **link** per package; each link names the **build** it last received.
- The **consumers registry** is the reverse index of all **links**, by package.
- **Publish** creates a build; **inject** delivers a build; **push** = publish + inject to every registered consumer.
- **Rollback** acts on the store; **restore** and **remove** act on a consumer.
