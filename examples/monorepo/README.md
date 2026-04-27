# Monorepo Example

A pnpm workspace where internal packages use workspace links and external packages use Knarr. This is the hybrid workflow: workspace links for co-developed packages, Knarr for testing published builds from separate repos.

## Structure

```text
monorepo/
|-- packages/
|   `-- shared-utils/       # @mono/shared-utils - workspace package
`-- apps/
    |-- web/                # Vite app + api-client through Knarr
    `-- server/             # Node app + ui-kit through Knarr
```

## Setup

### 1. Build the external packages

```bash
cd ../packages/api-client
npm install && npx tsup

cd ../ui-kit
npm install && npx tsup
```

### 2. Install the monorepo

```bash
cd ../../monorepo
pnpm install
```

This installs workspace links for `@mono/shared-utils` automatically.

### 3. Build the workspace package

```bash
cd packages/shared-utils
pnpm build
```

### 4. Link external packages via Knarr

```bash
cd ../../apps/web
knarr use ../../../packages/api-client

cd ../server
knarr use ../../../packages/ui-kit
```

### 5. Run

```bash
# Vite app
cd ../web
pnpm dev

# Node app, in another terminal
cd ../server
pnpm start
```

## Watch Mode

Edit an external package and see changes propagate:

```bash
cd ../../packages/api-client
knarr dev --build "npx tsup"
```

The Vite plugin in `apps/web` watches `.knarr/state.json` and triggers a full reload when Knarr pushes new files.

## Key Points

- `@mono/shared-utils` is linked via pnpm workspace protocol (`workspace:*`); no Knarr needed.
- `@example/api-client` and `@example/ui-kit` are injected via Knarr, simulating external packages from other repos.
- The Vite app uses the `knarr/vite` plugin for automatic reload on Knarr push.
