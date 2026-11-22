# Knarr Release Runbook

Releases go out only through the **Publish** workflow (`.github/workflows/publish.yml`) on `master`. Don't publish from a local machine: it would skip provenance and the isolated publish job. If the workflow breaks, fix the workflow.

## 1. Open a release PR

`master` only accepts changes through pull requests, so the version bump goes through one too.

1. Pick the version. A breaking change in a 0.x release bumps the minor version.
2. Set `package.json#version`.
3. Rename `## Unreleased` in `CHANGELOG.md` to `## <version>`. The section becomes the GitHub release notes, so start it with a one-line summary.
4. Run the local checks:

   ```bash
   pnpm lint && pnpm build && pnpm test
   pnpm compat:smoke
   pnpm audit --audit-level=low
   node scripts/verify-pack.mjs
   npm pack && npx ./knarr-<version>.tgz --help && npx ./knarr-<version>.tgz doctor
   ```

   Delete the tarball afterwards.

5. Open a PR titled `chore: release <version>` and merge it after CI passes.

## 2. Run the dry run

Run **Actions → Publish** on `master` with **Dry run** checked, or:

```bash
gh workflow run publish.yml --ref master -f dry_run=true
gh run watch "$(gh run list -w publish.yml -L 1 --json databaseId -q '.[0].databaseId')"
```

Only the **verify release** job runs. It needs no approval. It fails early if the version is already on npm or if `CHANGELOG.md` has no `## <version>` section. Then it runs audit, lint, build, tests, `scripts/verify-pack.mjs`, `npm pack`, and `npm publish --dry-run`. Check the packed file list in its log.

## 3. Publish

```bash
gh workflow run publish.yml --ref master -f dry_run=false
```

The workflow runs three jobs:

1. **verify release** repeats the dry run and uploads the tarball, its SHA-256, and the release notes.
2. **publish to npm** waits for approval in the `npm` environment. Approve it under the run's **Review deployments**. It has an OIDC credential and no checkout or install. It checks the tarball's SHA-256 and runs `npm publish --provenance` with network egress limited by harden-runner. If harden-runner blocks a host, review it before adding it to `allowed-endpoints`.
3. **create GitHub release** tags the commit `v<version>` and creates the release from the changelog section.

Afterwards, check:

```bash
npm view knarr version dist-tags
npx knarr@<version> --help
```

## If something fails

- Verify fails: fix it on a branch, merge, and run the workflow again. Nothing was published.
- Publish fails: nothing was published. npm also refuses a version that already exists, so a rerun can't publish twice.
- Release creation fails after a publish: the package is on npm. Rerun the failed job, or run `gh release create v<version> --target <sha> --notes-file <notes>` by hand.
