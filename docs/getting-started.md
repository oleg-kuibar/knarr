# Getting started

Knarr's shortest path is `knarr use`: run it in the app, point it at the local package, and knarr publishes + links the package in one step.

## Install

```bash
pnpm add -g knarr

# or use it one time without installing globally
npx knarr use ../my-lib
```

> **Tip:** Running `knarr` with no arguments in a terminal shows an interactive menu where you can select the command you want to run.

## 1. Link a local package into your app

```bash
cd my-app
npx knarr use ../my-lib
```

This command:

1. Reads `../my-lib/package.json` and infers the package name
2. Publishes the built package files to `~/.knarr/store/`
3. Initializes `.knarr/` in the app if needed
4. Copies the package into `my-app/node_modules/`
5. Records the link so future `knarr push` and `knarr dev` runs know where to update

`knarr use` is equivalent to:

```bash
cd ../my-lib
knarr publish

cd ../my-app
knarr add my-lib
```

## 2. Start the continuous dev loop

```bash
cd ../my-lib
knarr dev
```

`knarr dev` auto-detects your build command from `package.json` scripts and enters watch mode. Each change is coalesced, rebuilt, published, and pushed to every app that has the package linked.

If Knarr is not installed globally, run `npx knarr dev` instead.

```mermaid
graph LR
    A[Edit package] --> B[Build]
    B --> C[Publish to store]
    C --> D[Copy changed files]
    D --> E[Consumer bundler updates]

    style A fill:#2e7d32,stroke:#66bb6a,color:#e8f5e9
    style B fill:#1565c0,stroke:#64b5f6,color:#e3f2fd
    style C fill:#6a1b9a,stroke:#ba68c8,color:#f3e5f5
    style D fill:#e65100,stroke:#ffb74d,color:#fff3e0
    style E fill:#00838f,stroke:#4dd0e1,color:#e0f2f1
```

For explicit control:

```bash
knarr push --watch --build "pnpm build"
knarr push --watch --skip-build
```

## 3. Use explicit publish/add when you need it

Use `publish` and `add` separately when you want to publish once, pin a version, or link something that is already in the store:

```bash
cd my-lib
pnpm build
knarr publish

cd ../my-app
knarr add my-lib
knarr add @scope/my-lib@1.2.3
knarr add my-lib --from ../my-lib
```

## 4. After `npm install`

Running `npm install`, `pnpm install`, `yarn install`, or `bun install` can wipe `node_modules/` overrides. Get them back:

```bash
knarr restore
```

If you ran `knarr init` or `knarr use`, this can happen automatically via the `postinstall` hook.

## 5. Clean up

When you're done with local development:

```bash
knarr remove my-lib
```

This removes the Knarr link and restores the original npm-installed version if one was backed up.

## Migrating from yalc

```bash
cd my-app
npx knarr migrate
npx knarr use ../my-lib

cd ../my-lib
knarr dev
```

See [Migrating from yalc](migrating-from-yalc.md) for the full guide.

## Try it for real

The [examples/](../examples/) folder has a working setup: two library packages, a Node.js consumer, and a React + Vite app with HMR.

## Next

- [Commands](commands.md) - every flag
- [How It Works](how-it-works.md) - store format, injection, copies
- [Bundler Guide](bundlers.md) - Vite, Webpack, esbuild setup
