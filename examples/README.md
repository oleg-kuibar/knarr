# Examples

Runnable demos showing Knarr with different package managers and project setups.

## What's Here

```text
examples/
|-- packages/                  # Shared libraries, also used as E2E fixtures
|   |-- api-client/            # @example/api-client - types + fetch helpers
|   `-- ui-kit/                # @example/ui-kit - Button, Card components
|
|-- standalone/                # Non-monorepo apps, one per package manager
|   |-- npm-app/               # npm - Node.js CLI
|   |-- pnpm-app/              # pnpm - Vite + vanilla TS
|   |-- yarn-app/              # yarn v4 with nodeLinker: node-modules
|   `-- bun-app/               # bun - Node.js/Bun CLI
|
`-- monorepo/                  # pnpm workspace links + Knarr side by side
    |-- packages/shared-utils/ # @mono/shared-utils - workspace package
    `-- apps/
        |-- web/               # Vite app + api-client through Knarr
        `-- server/            # Node app + ui-kit through Knarr
```

## Quick Start

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

### 3. Try a standalone app

```bash
cd ../../standalone/npm-app
npm install
knarr use ../../packages/api-client
knarr use ../../packages/ui-kit
npm start
```

See [standalone/README.md](standalone/README.md) for all four package-manager demos.

### 4. Try the monorepo

```bash
cd ../../monorepo
pnpm install
cd packages/shared-utils && pnpm build
cd ../../apps/web
knarr use ../../../packages/api-client
pnpm dev
```

See [monorepo/README.md](monorepo/README.md) for the full workspace guide.

## Watch Mode

Make changes to a package and see them propagate automatically:

```bash
cd packages/api-client
knarr dev --build "npx tsup"
```

Edit `src/client.ts`, save. Knarr rebuilds, publishes, and copies to all consumers.

## More

- [Getting Started](../docs/getting-started.md)
- [Commands](../docs/commands.md)
- [Bundler Guide](../docs/bundlers.md)
