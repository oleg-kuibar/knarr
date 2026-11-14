---
name: verify
description: Run Knarr's local verification gate (fixtures, lint, build, tests, and compat smoke when relevant) and report the results accurately. Use after changing code and before saying work is done or opening a PR.
argument-hint: "[quick|full]"
---

Run the gate in this order and stop at the first stage that fails. `quick` (the default) means steps 1–4. `full` adds step 5.

1. **pnpm**: if `pnpm --version` fails, use `npx -y pnpm@<version>` everywhere below, taking the version from `package.json#packageManager`. Node must satisfy `engines.node` (>= 22.22).
2. **Fixtures**: if `examples/packages/api-client/dist/index.js` or `examples/packages/ui-kit/dist/index.js` is missing, run `npm ci && npx tsup` in that package directory.
3. `pnpm lint`, then `pnpm build`.
4. `pnpm test`. If it fails, hand the failure to the `knarr-test-triager` subagent instead of reading long logs in the main context.
5. **full only**, or whenever `src/core/injector.ts`, `src/utils/package-manager.ts`, `src/utils/pm-detect.ts`, the plugins, or `scripts/compat-smoke.mjs` changed: run `pnpm compat:smoke`. It needs npm, pnpm, yarn (Berry), and bun on PATH. If one is missing, say which scenarios didn't run; don't report them as passing.

## Reporting

Give one line per stage with pass or fail and counts (tests passed / failed / skipped). Skips from `canCreateSymlinks` are expected on Windows without Developer Mode: report them as skipped, and point out that CI runs them. Never call a stage green if it didn't run.
