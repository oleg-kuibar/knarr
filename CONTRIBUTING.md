# Contributing

## Development setup

```bash
git clone https://github.com/oleg-kuibar/knarr.git
cd knarr
pnpm install
pnpm build
```

### Running locally

```bash
# Link the CLI globally for testing
pnpm link --global

# Now you can use `knarr` anywhere
knarr --help
```

### Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Build with tsup |
| `pnpm dev` | Build in watch mode |
| `pnpm test` | Run tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm bench` | Run benchmarks |
| `pnpm lint` | Type-check with tsc |

## Project structure

```
src/
|-- cli.ts                # Entry point, citty command routing
|-- commands/             # CLI command definitions (one file per command)
|-- core/                 # Core logic (publisher, injector, store, tracker, watcher)
|-- utils/                # Shared utilities (fs, hash, paths, pack-list, pm-detect, bin-linker)
|-- vite-plugin.ts        # Vite plugin entry (exported as knarr/vite)
|-- types.ts              # Shared TypeScript types
`-- index.ts              # Public API exports
```

See [How it works](docs/how-it-works.md) for details on the store, injection, and copy strategy.

## Testing

Tests use [vitest](https://vitest.dev/) with a 70% line coverage threshold (`vitest.config.ts`).

### Test layers

| Layer | Location | What it tests |
|---|---|---|
| Unit | `src/utils/__tests__/*.test.ts` (12 files) | Individual utilities in isolation |
| Integration | `src/__tests__/integration.test.ts` | Core APIs (publish, inject, store) using temp dirs |
| E2E | `src/__tests__/e2e.test.ts` | Full CLI flows using real fixtures from `examples/packages/` |
| Standalone emulation | `src/__tests__/standalone-emulate.test.ts` | Real package manager install + CLI invocation |
| Benchmarks | `src/__tests__/publish-inject.bench.ts`, `src/utils/__tests__/hash.bench.ts` | Performance measurements (run with `pnpm bench`) |

### Running e2e tests

The e2e tests require example packages to be built first:

```bash
cd examples/packages/api-client && pnpm install && pnpm tsup
cd ../ui-kit && pnpm install && pnpm tsup
cd ../../..
pnpm test
```

### `examples/` directory

| Directory | Purpose |
|---|---|
| `examples/packages/` | Test fixture packages (`api-client`, `ui-kit`) - used by e2e tests |
| `examples/standalone/` | Package manager demo apps (npm, pnpm, yarn, bun) for manual testing |
| `examples/monorepo/` | Workspace example with multiple packages |

### Writing tests

- Tests use `KNARR_HOME` env var to redirect the store to a temp directory
- Each test creates fresh temp dirs and cleans up in `afterEach`
- Prefer testing through the core module APIs rather than CLI

## Submitting changes

1. Fork the repo and create a branch from `master`
2. Make your changes
3. Add or update tests as needed
4. Run `pnpm test` and `pnpm lint` to verify
5. Open a pull request

## Releasing

### Canary builds

Every push to `master` automatically publishes a canary version to npmjs.org:

```
0.2.0-canary.<short-sha>
```

Install with `npm install knarr@canary`.

### Stable releases

Two options:

**Option A - GitHub Actions UI (recommended)**

1. Go to Actions -> Release -> Run workflow
2. Pick a bump type (`patch` / `minor` / `major` / `custom`)
3. Optionally check **Dry run** to build and test without publishing
4. Click **Run workflow**

The workflow bumps `package.json`, commits, tags, pushes to `master`, publishes to npm, and creates a GitHub Release.

**Option B - Manual tag push**

```bash
# Bump locally
npm version patch            # or minor / major
git push origin master --follow-tags
```

The tag push triggers the same publish pipeline.

### Prerequisites

Publishing uses npm Trusted Publishing (OIDC) - no secrets needed. The `knarr` package must have the GitHub repo configured as a trusted publisher on npmjs.com.

## Code style

- TypeScript with strict mode
- ESM (`type: "module"`)
- No default exports (except CLI commands for citty)
- Use `consola` for user-facing output
- Use `picocolors` for terminal colors
