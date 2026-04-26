# Examples

Runnable demos showing Knarr with different package managers and project setups.

## What's here

```
examples/
├── packages/                  # Shared libraries (also used as E2E test fixtures)
│   ├── api-client/            # @example/api-client — types + fetch helpers
│   └── ui-kit/                # @example/ui-kit — Button, Card components
│
├── standalone/                # Non-monorepo apps, one per package manager
│   ├── npm-app/               # npm — Node.js CLI
│   ├── pnpm-app/              # pnpm — Vite + vanilla TS
│   ├── yarn-app/              # yarn v4 (nodeLinker: node-modules) — Node.js CLI
│   └── bun-app/               # bun — Node.js/Bun CLI
│
└── monorepo/                  # pnpm workspace — workspace links + Knarr side by side
    ├── packages/shared-utils/ # @mono/shared-utils — workspace package
    └── apps/
        ├── web/               # Vite app — shared-utils (workspace) + api-client (Knarr)
        └── server/            # Node app — shared-utils (workspace) + ui-kit (Knarr)
```

## Quick start

### 1. Build Knarr

```bash
# From the repo root
pnpm install
pnpm build
pnpm link --global
```

### 2. Build the packages

```bash
cd examples/packages/api-client
npm install && npx tsup

cd ../ui-kit
npm install && npx tsup
```

### 3. Publish to Knarr store

```bash
cd ../api-client && knarr publish
cd ../ui-kit && knarr publish
```

### 4. Try a standalone app

```bash
cd ../../standalone/npm-app
npm install
knarr add @example/api-client --from ../../packages/api-client
knarr add @example/ui-kit --from ../../packages/ui-kit
npm start
```

See [standalone/README.md](standalone/README.md) for all four apps.

### 5. Try the monorepo

```bash
cd ../../monorepo
pnpm install
cd packages/shared-utils && pnpm build
cd ../../apps/web
knarr add @example/api-client --from ../../../packages/api-client
pnpm dev
```

See [monorepo/README.md](monorepo/README.md) for the full guide.

## Watch mode

Make changes to a package and see them propagate automatically:

```bash
cd packages/api-client
knarr push --watch --build "npx tsup"
```

Edit `src/client.ts`, save. Knarr rebuilds, publishes, and copies to all consumers.

## More

- [Getting started](../docs/getting-started.md)
- [Commands](../docs/commands.md)
- [Bundler guide](../docs/bundlers.md) (Vite config, etc.)
