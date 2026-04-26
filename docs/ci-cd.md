# Using Knarr in CI/CD

Knarr can run in CI pipelines to test against local (unpublished) versions of packages — useful when you want to verify a library change doesn't break consumers before publishing to npm.

## Key flags for CI

### --json

All Knarr commands support `--json` for machine-readable output. When enabled, human-readable log messages are suppressed and structured JSON is printed to stdout.

```bash
knarr publish --json
# Output:
# {
#   "name": "my-lib",
#   "version": "1.0.0",
#   "files": 12,
#   "skipped": false,
#   "elapsed": 45
# }

knarr status --json
knarr list --json
knarr push --json
```

Use this to parse results in CI scripts:

```bash
RESULT=$(knarr push --json)
CONSUMERS=$(echo "$RESULT" | jq '.consumers')
echo "Pushed to $CONSUMERS consumer(s)"
```

### --dry-run

Preview what Knarr would do without writing any files:

```bash
knarr publish --dry-run
knarr push --dry-run
```

When `--dry-run` completes, Knarr prints a grouped summary of all mutations that would have been performed (file copies, removals, directory creation, bin links, lock acquisitions, lifecycle hooks). With `--json`, the summary is output as structured JSON.

Good for validation steps where you want to confirm the operation succeeds without writing files.

### --verbose

Enable debug-level logging for troubleshooting CI failures:

```bash
knarr push --verbose
```

Logs file hash computations, symlink resolution, store operations, and timing. In combination with `--json`, verbose logs go to stderr while structured output goes to stdout.

### --private

Allow publishing packages that have `"private": true` in package.json:

```bash
knarr publish --private
```

Private packages are skipped by default. Use this flag in CI when testing internal packages that are not meant for the npm registry.

## KNARR_HOME for isolated environments

By default, Knarr stores data in `~/.knarr/`. In CI, you typically want an isolated store per job to avoid cross-contamination between builds.

Set the `KNARR_HOME` environment variable to redirect the store:

```bash
export KNARR_HOME=$(mktemp -d)
knarr publish
knarr add my-lib
```

Or inline:

```bash
KNARR_HOME=/tmp/knarr-ci knarr publish
KNARR_HOME=/tmp/knarr-ci knarr add my-lib
```

Everything (store, registry, metadata) goes under that directory.

## GitHub Actions example

A full workflow: build a library, inject it into a consumer, run the consumer's tests.

```yaml
name: Test with local packages

on:
  pull_request:
    paths:
      - 'packages/my-lib/**'
      - 'apps/my-app/**'

jobs:
  integration-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install

      - name: Build library
        run: pnpm --filter my-lib build

      - name: Set up Knarr
        env:
          KNARR_HOME: ${{ runner.temp }}/knarr
        run: |
          cd apps/my-app
          npx knarr init -y

      - name: Publish and link
        env:
          KNARR_HOME: ${{ runner.temp }}/knarr
        run: |
          npx knarr publish packages/my-lib
          cd apps/my-app
          npx knarr add my-lib

      - name: Verify link
        env:
          KNARR_HOME: ${{ runner.temp }}/knarr
        run: |
          cd apps/my-app
          npx knarr status --json

      - name: Run consumer tests
        run: pnpm --filter my-app test

      - name: Run consumer build
        run: pnpm --filter my-app build
```

Key points:

- `KNARR_HOME` is set to `${{ runner.temp }}/knarr` so the store is isolated to the job and cleaned up automatically.
- `knarr init -y` skips interactive prompts.
- `knarr status --json` is used as a verification step.
- The library is built before publishing, since Knarr copies built output.

## Testing multiple consumers

If you have several apps that depend on the same library, you can push to all of them at once:

```yaml
      - name: Publish library
        env:
          KNARR_HOME: ${{ runner.temp }}/knarr
        run: npx knarr publish packages/my-lib

      - name: Link to all consumers
        env:
          KNARR_HOME: ${{ runner.temp }}/knarr
        run: |
          for app in apps/app-1 apps/app-2 apps/app-3; do
            cd $app
            npx knarr init -y
            npx knarr add my-lib
            cd ${{ github.workspace }}
          done

      - name: Run all tests
        run: pnpm --filter './apps/*' test
```

## Validating with --dry-run

Add a dry-run step to catch packaging issues without modifying anything:

```yaml
      - name: Validate packaging
        run: npx knarr publish packages/my-lib --dry-run --json
```

Catches `files` field or `.npmignore` mistakes before writing to the store.

## Tips

- Always set `KNARR_HOME` in CI. The default `~/.knarr/` may persist across cached runners and cause stale state.
- Use `--json` for any step where you need to parse output or check results programmatically.
- Run `knarr doctor --json` as a diagnostic step if link verification fails.
- Knarr does not require global installation. `npx knarr` works in any step.
- The `postinstall` hook (`knarr restore || true`) is safe in CI -- if Knarr is not installed globally, `|| true` prevents the hook from failing.
