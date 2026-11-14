## Summary

<!-- What changed and why? -->

## Review focus

<!-- Risk areas for reviewers and AI review: store writes, symlink/junction handling, PM layouts, watch mode, config rewriting, JSON output, Windows paths, docs-only, ... -->

## Verification

<!-- e.g. pnpm lint, pnpm build, pnpm test (N passed / M skipped), pnpm compat:smoke, manual CLI smoke test -->

## Checklist

- [ ] Tests cover the risky behavior (or this is docs/tooling only).
- [ ] `pnpm lint` passes with no new `eslint-disable`, or each one has a comment explaining why.
- [ ] Public CLI/API changes are documented in `docs/commands.md` / `docs/api.md`, and `CHANGELOG.md` has an "Unreleased" entry.
- [ ] AI review: `@codex review`, Claude Code `/knarr-review`, or a note on why it isn't needed.

## Notes

<!-- Risks, follow-ups, or migration notes -->
