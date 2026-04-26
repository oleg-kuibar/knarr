# Monorepo Example

A pnpm workspace where **internal packages use workspace links** and **external packages use Knarr**. This is the hybrid workflow: workspace links for co-developed packages, Knarr for testing published builds from separate repos.

## Structure

```
monorepo/
├── packages/
│   └── shared-utils/       # @mono/shared-utils — workspace package (pnpm link)
└── apps/
    ├── web/                 # Vite app — shared-utils (workspace) + api-client (Knarr)
    └── server/              # Node app — shared-utils (workspace) + ui-kit (Knarr)
```

## Setup

### 1. Build the external packages

```bash
cd ../packages/api-client
npm install && npx tsup

cd ../ui-kit
npm install && npx tsup
```

### 2. Publish external packages to Knarr store

```bash
cd ../api-client && knarr publish
cd ../ui-kit && knarr publish
```

### 3. Install the monorepo

```bash
cd ../../monorepo
pnpm install
```

This installs workspace links for `@mono/shared-utils` automatically.

### 4. Build the workspace package

```bash
cd packages/shared-utils
pnpm build
```

### 5. Link external packages via Knarr

```bash
cd ../../apps/web
knarr add @example/api-client --from ../../../packages/api-client

cd ../server
knarr add @example/ui-kit --from ../../../packages/ui-kit
```

### 6. Run

```bash
# Vite app
cd ../web
pnpm dev

# Node app (in another terminal)
cd ../server
pnpm start
```

## Watch mode

Edit an external package and see changes propagate:

```bash
cd ../../packages/api-client
knarr push --watch --build "npx tsup"
```

The Vite plugin in `apps/web` watches `.knarr/state.json` and triggers a full reload when knarr pushes new files.

## Key points

- `@mono/shared-utils` is linked via pnpm workspace protocol (`workspace:*`) — no Knarr needed
- `@example/api-client` and `@example/ui-kit` are injected via Knarr — simulating external packages from other repos
- The Vite app uses `knarr/vite` plugin for automatic reload on knarr push
