# Knarr Release Runbook

This repo has been renamed from `@olegkuibar/plunk` to `knarr`.

## Preflight

Run these immediately before publishing:

```bash
npm view knarr name version
pnpm install
pnpm lint
pnpm test
pnpm build
npm pack --dry-run
```

`npm view knarr` should return a 404-style "not found" response. If it returns package metadata, the unscoped name has been taken and the release should stop.

## Smoke Test The Tarball

```bash
npm pack
npx ./knarr-<version>.tgz --help
npx ./knarr-<version>.tgz use ../my-lib --dry-run
```

Inspect the dry-run output and tarball contents. The CLI name, docs, generated declarations, and runtime strings should say `knarr`, `.knarr`, and `.knarr-meta.json`.

## Publish Knarr

```bash
pnpm publish --access public
```

After publish:

```bash
npm view knarr name version bin dist-tags
npx knarr --help
```

## Archive The Old Package

Deprecate the old scoped package after `knarr` is published and smoke-tested:

```bash
npm deprecate @olegkuibar/plunk@"*" "Renamed to knarr. Install with: npm install knarr or run: npx knarr ..."
```

Do not deprecate the unscoped `plunk` package unless it is owned by this project.

## Follow-Up

- Rename the GitHub repository to `oleg-kuibar/knarr`.
- Configure npm Trusted Publishing for `knarr`.
- Update project URLs, deployment domains, and badges.
- Keep legacy compatibility for one release cycle: `PLUNK_HOME`, `package.json#plunk`, old Vite import removal, and `preplunk`/`postplunk`.
