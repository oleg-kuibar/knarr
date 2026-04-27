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

Use GitHub Actions -> Publish.

1. Run with **Dry run** enabled.
2. Inspect the `npm pack --dry-run` output.
3. Re-run with **Dry run** disabled after npm Trusted Publishing is configured.

Manual fallback, from a clean local checkout:

```bash
npm publish --provenance --access public
```

After publish:

```bash
npm view knarr name version bin dist-tags
npx knarr --help
```

## Follow-Up

- Confirm npm Trusted Publishing is configured for `knarr`.
- Confirm project URLs and badges point to `oleg-kuibar/knarr`.
- Keep the Knarr public surface clean: `KNARR_HOME`, `package.json#knarr`, `knarr/vite`, `preknarr`, and `postknarr`.
