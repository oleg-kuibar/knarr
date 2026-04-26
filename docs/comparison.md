# npm link vs yalc vs Knarr

You're developing a library and an app that uses it. You want changes to show up in the app without publishing to npm. Here's how the three main tools handle this, and where each breaks down.

## How they work

### npm link (symlinks)

```mermaid
graph LR
    A["my-lib/"] -- "npm link" --> B["global<br/>node_modules/my-lib"]
    B -- "npm link my-lib" --> C["app/node_modules/my-lib<br/>(symlink → global)"]

    style A fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style B fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style C fill:#c62828,stroke:#ef5350,color:#ffebee
```

Creates a symlink chain: library → global `node_modules` → consumer's `node_modules`. The catch is that Node.js resolves `require()` from the *real* path, not the link location.

### yalc (copy + package.json mutation)

```mermaid
graph LR
    A["my-lib/"] -- "yalc publish" --> B["~/.yalc/<br/>my-lib/"]
    B -- "yalc add" --> C["app/node_modules/my-lib<br/>(copied files)"]
    B -- "yalc add" --> D["app/.yalc/my-lib<br/>(yalc store)"]
    B -- "yalc add" --> E["app/package.json<br/>(modified dep)"]

    style A fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style B fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style C fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style D fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style E fill:#c62828,stroke:#ef5350,color:#ffebee
```

Copies files but also rewrites the consumer's `package.json` to point to `.yalc/`. This shows up in `git diff`, CI might pick it up, and `npm publish` from the consumer could accidentally include the local override.

### Knarr (copy only)

```mermaid
graph LR
    A["my-lib/"] -- "knarr publish" --> B["~/.knarr/store/<br/>my-lib@1.0.0"]
    B -- "knarr add" --> C["app/node_modules/my-lib<br/>(copied files)"]

    style A fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style B fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style C fill:#e65100,stroke:#ffb74d,color:#fff3e0
```

Copies files to a global store, then from the store into `node_modules/`. State is tracked in a gitignored `.knarr/` directory. Your `package.json` is never modified.

## Side by side

| | npm link | yalc | Knarr |
|---|---|---|---|
| Module resolution | Broken (dual instances) | Works | Works |
| Git contamination | None | package.json + .yalc/ | None |
| Bundler HMR | Often broken | Fragile | Works |
| pnpm support | Fragile | Broken since v7.10 | Works |
| Watch mode | None | External (yalc-watch) | Built-in |
| Survives npm install | No | No | `knarr restore` |
| Lock file safe | Yes | Can corrupt | Never touches lockfiles |
| CI safe | Yes | Risk of leaking | Nothing in git |
| npm publish safe | Yes | Risk of leaking | Nothing in package.json |
| Transitive dep warnings | No | No | Yes |
| Incremental copy | N/A | Full copy each time | mtime + xxhash diff (parallel) |
| Backup/restore | No | No | Yes |
| Scoped packages | Works | Fragile | Works |

## Where things break

### Duplicate dependencies (npm link)

```mermaid
graph TB
    subgraph "npm link (broken)"
        App1[app] --> React1["react@18 ①"]
        App1 --> Lib1["my-lib (symlink)"]
        Lib1 --> React2["react@18 ②"]
    end

    subgraph "Knarr (works)"
        App2[app] --> React3["react@18"]
        App2 --> Lib2["my-lib (copied)"]
        Lib2 -.-> React3
    end

    style App1 fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style React1 fill:#c62828,stroke:#ef5350,color:#ffebee
    style React2 fill:#c62828,stroke:#ef5350,color:#ffebee
    style Lib1 fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style App2 fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style React3 fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style Lib2 fill:#00838f,stroke:#4dd0e1,color:#e0f2f1
```

With symlinks, `my-lib`'s `require('react')` resolves from the library's real location, which has its own `node_modules/react`. Now you have two React instances. Hooks fail silently, `instanceof` returns false, context doesn't propagate. It's one of those bugs where everything looks right but nothing works.

With Knarr, `my-lib` is inside the consumer's `node_modules/`, so `require('react')` resolves to the same copy the app uses.

### Git contamination (yalc)

yalc modifies `package.json`:
```diff
 "dependencies": {
-  "my-lib": "^1.0.0"
+  "my-lib": "file:.yalc/my-lib"
 }
```

It also creates a `.yalc/my-lib/` directory. Forget to revert before committing and your team gets broken builds.

Knarr keeps everything in `.knarr/` which is gitignored. Your `package.json` stays clean.

### pnpm (yalc + npm link)

pnpm uses a content-addressable store with symlinks to a `.pnpm/` virtual store. Neither `npm link` nor yalc understand this structure, and yalc has been broken with pnpm since v7.10.

Knarr detects pnpm, follows the symlink chain into `.pnpm/`, and replaces files at the real directory. The existing symlink structure stays intact.

### Bundler HMR

| Scenario | npm link | yalc | Knarr |
|---|---|---|---|
| Vite detects changes | No (symlink outside project) | Fragile (.yalc not watched) | Yes (plugin auto-injected) |
| Webpack re-builds | Sometimes | Sometimes | Yes (optional plugin for cache invalidation) |
| rspack re-builds | Sometimes | Sometimes | Yes (same plugin as webpack) |
| Turbopack | No (outside root) | Unknown | Yes |

Knarr writes real files at `node_modules/` paths, which generates filesystem events bundlers can see. See [Bundler Guide](bundlers.md) for Vite config.

### Watch mode

| Tool | Watch support |
|---|---|
| npm link | None (manual re-link) |
| yalc | External package (yalc-watch), unmaintained |
| Knarr | Built-in: `knarr dev` (auto-detects build) or `knarr push --watch --build "tsup"` |

Knarr's watch mode handles the full loop: file change → coalesce (500ms) → build → publish → push. `knarr dev` auto-detects the build command from `package.json` scripts, so you just run `knarr dev` and start editing. Changes are detected immediately but batched. If new changes arrive while a push is running, Knarr automatically re-pushes. Build failures get logged but the watcher keeps running.

### After npm install

`npm install` wipes `node_modules/` overrides:

| Tool | After `npm install` |
|---|---|
| npm link | Symlinks gone, manual re-link |
| yalc | References gone, `yalc link` again |
| Knarr | Run `knarr restore` (or automatic via postinstall hook) |

`knarr init` sets up a `postinstall` hook, so `knarr restore` runs automatically after every install.

## When to use what

`npm link` is fine for quick one-off tests where you just need to check if something works.

Knarr is the better choice when you're doing ongoing development, using pnpm, working on a team (where git contamination matters), or testing in CI.

yalc still works if you can't install new tools or are on a very old Node version.
