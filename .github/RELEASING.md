# Knarr Release Runbook

## Preflight

Run these immediately before the first publish:

```bash
npm view knarr name version
pnpm install
pnpm lint
pnpm build
pnpm test
npm pack --dry-run
```

Before the first publish, `npm view knarr` should return a 404-style "not found" response. If it returns package metadata, the unscoped name has been taken and the release should stop. After `knarr` exists on npm, verify the intended version is not already published.

## Smoke Test The Tarball

```bash
npm pack
npx ./knarr-<version>.tgz --help
npx ./knarr-<version>.tgz use ../my-lib --dry-run
```

Inspect the dry-run output and tarball contents. The CLI name, docs, generated declarations, and runtime strings should say `knarr`, `.knarr`, and `.knarr-meta.json`.

## Publish Knarr

Use GitHub Actions -> Publish, from `master` only. The workflow has two jobs:

- **verify release** (read-only): audit, lint, build, test, `scripts/verify-pack.mjs`, then `npm pack` and upload the tarball with its SHA-256.
- **publish to npm** (`npm` environment, OIDC): no checkout or install. It checks the tarball's SHA-256, refuses an already-published version, and runs `npm publish --provenance` with network egress limited by harden-runner.

1. Run with **Dry run** enabled. The publish job runs `npm publish --dry-run`, which also checks the egress allowlist. If harden-runner blocks a host, review it before adding it to `allowed-endpoints`.
2. Inspect the packed file list in the verify job log.
3. Re-run with **Dry run** disabled.

There is no manual fallback: don't publish from a local machine. It would skip provenance and the isolated publish job. If the workflow is broken, fix the workflow.

After publish:

```bash
npm view knarr name version bin dist-tags
npx knarr --help
```

## Follow-Up

- Confirm npm Trusted Publishing is configured for `knarr`.
- Confirm project URLs and badges point to `oleg-kuibar/knarr`.
- Keep the Knarr public surface clean: `KNARR_HOME`, `package.json#knarr`, `knarr/vite`, `preknarr`, and `postknarr`.
