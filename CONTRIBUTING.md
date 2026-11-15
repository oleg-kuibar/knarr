# Contributing

## Development setup

```bash
git clone https://github.com/oleg-kuibar/knarr.git
cd knarr
pnpm install
pnpm build

# e2e fixtures (they use npm, not pnpm)
(cd examples/packages/api-client && npm ci && npx tsup)
(cd examples/packages/ui-kit && npm ci && npx tsup)
```

### Running locally

```bash
# Install the local CLI globally for testing (pnpm 11+ removed `pnpm link --global`)
pnpm add -g .

# Now you can use `knarr` anywhere
knarr --help
```

### Scripts

| Command | What it does |
|---|---|
| `pnpm build` | Build with tsdown |
| `pnpm dev` | Build in watch mode |
| `pnpm test` | Run tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm bench` | Run benchmarks |
| `pnpm compat:smoke` | Install the packed CLI into real npm, pnpm, Yarn, and Bun apps plus Vite, Webpack, rspack, and Next builds (run `pnpm build` first) |
| `pnpm lint` | Strict type-check (source and tests), then oxlint secure-coding rules |
| `pnpm lint:fix` | Auto-fix oxlint issues |

## Requirements

- Node.js 22.22 or newer
- pnpm 12 (pinned in `package.json#packageManager`). Node 22 and 24 bundle corepack, so `corepack enable` is enough. On Node 25+, run `npm i -g corepack && corepack enable` first.
- On Windows, symlink-based tests need Developer Mode (or an elevated shell). Without it they are reported as skipped. CI runs them.

## Project structure

```
src/
|-- cli.ts                # Entry point, citty command routing
|-- commands/             # CLI command definitions (one file per command)
|-- core/                 # Core logic (publisher, injector, store, tracker, watcher)
|-- utils/                # Shared utilities (fs, hash, paths, package-manager, pack-list, bin-linker, shell)
|-- vite-plugin.ts        # Vite plugin entry (exported as knarr/vite)
|-- webpack-plugin.ts     # Webpack/rspack plugin entry (exported as knarr/webpack)
|-- types.ts              # Shared TypeScript types
`-- index.ts              # Public API exports
```

See [How it works](docs/how-it-works.md) for details on the store, injection, and copy strategy.

## Testing

Tests use [vitest](https://vitest.dev/) with a 70% line coverage threshold (`vitest.config.ts`).

### Test layers

| Layer | Location | What it tests |
|---|---|---|
| Unit | `src/utils/__tests__/*.test.ts` | Individual utilities in isolation |
| Integration | `src/__tests__/integration.test.ts` | Core APIs (publish, inject, store) using temp dirs |
| E2E | `src/__tests__/e2e.test.ts` | Full CLI flows using real fixtures from `examples/packages/` |
| Watcher | `src/__tests__/watcher.test.ts` | Real chokidar watching, debounce, and ignore rules |
| Standalone emulation | `src/__tests__/standalone-emulate.test.ts` | Real package manager install + CLI invocation |
| Benchmarks | `src/__tests__/*.bench.ts`, `src/utils/__tests__/hash.bench.ts` | Performance measurements (run with `pnpm bench`; Vitest 5 `({ bench })` test-context API) |

### Running e2e tests

The e2e tests require example packages to be built first:

```bash
cd examples/packages/api-client && npm ci && npx tsup
cd ../ui-kit && npm ci && npx tsup
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
- Tests that create symlinks use `it.skipIf(!canCreateSymlinks)` from `src/__tests__/helpers/symlinks.ts`
- Run one file with `pnpm vitest run <file>`, or one test with `-t "suite > test"`

## Submitting changes

1. Fork the repo and create a branch from `master`
2. Make your changes
3. Add or update tests as needed
4. Run `pnpm test` and `pnpm lint` to verify
5. Open a pull request

## AI-assisted review

Shared agent guidance lives in [AGENTS.md](AGENTS.md). Codex reads it directly, and Claude Code loads it through [CLAUDE.md](CLAUDE.md), which only imports `AGENTS.md`; put Claude-specific guidance in `AGENTS.md` too. Keep repeated review feedback there, not only in one-off comments, so every tool applies it.

| Tool | How to run it | Definitions |
|---|---|---|
| Codex on GitHub | Comment `@codex review` on the PR (or enable automatic reviews) | `AGENTS.md` "Review guidelines" |
| Codex CLI/app | `codex review --uncommitted`, or ask it to spawn `knarr_pr_mapper`, `knarr_reviewer`, and `knarr_docs_checker` against `master` | `.codex/agents/` |
| Claude Code | `/knarr-review` (reviewer and docs checker in parallel), `/verify` (local gate), `/upgrade-deps`, `/release` | `.claude/agents/`, `.claude/skills/` |
| CodeRabbit | Automatic on PRs | `.coderabbit.yaml` |

Treat AI feedback as an extra maintainer signal. Human review and CI still decide whether a change is ready.

Maintainer setup for Codex: set up Codex cloud for `oleg-kuibar/knarr` and enable Code review for the repository in Codex settings.

## Releasing

### Stable Releases

1. Confirm `package.json` contains the intended version.
2. Go to Actions -> Publish -> Run workflow
3. Keep **Dry run** enabled for the first run and inspect `npm pack --dry-run`
4. Configure npm Trusted Publishing for the `npm` environment
5. Re-run with **Dry run** disabled

### Prerequisites

Publishing uses npm Trusted Publishing (OIDC) - no secrets needed. The `knarr` package must have the GitHub repo configured as a trusted publisher on npmjs.com.

## Code style

- TypeScript strict mode plus `noUncheckedIndexedAccess`, `noUnusedLocals`/`Parameters`, `noImplicitReturns`/`Override`. Tests are type-checked too, and the public API uses `isolatedDeclarations` (`tsconfig.dts.json`).
- Secure-coding rules (untrusted JSON, processes, async safety, and more) are in [AGENTS.md](AGENTS.md#secure-coding) and enforced by `pnpm lint`.
- ESM (`type: "module"`)
- No default exports (except CLI commands for citty)
- Use `consola` for user-facing output
- Use `pc` from `src/utils/colors.ts` (Node's `util.styleText`) for terminal colors
