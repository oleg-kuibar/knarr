@AGENTS.md

## Claude Code

- After code changes, run the `verify` skill (lint, build, test, plus compat smoke when injection or PM code changed) before reporting done. Report skipped symlink tests as skips, not passes.
- Use the subagents in `.claude/agents/` for isolated work:
  - `knarr-reviewer`: correctness and data-safety review of a diff (read-only).
  - `knarr-docs-checker`: docs, CLI help, and changelog drift for a diff (read-only).
  - `knarr-test-triager`: run tests and diagnose failures without filling the main context with logs.
- `/knarr-review` runs the reviewer and docs checker in parallel against `master` and merges their findings.
- `/upgrade-deps` and `/release` are user-invoked procedures. Don't start them unprompted.
- Personal notes go in `CLAUDE.local.md` (gitignored), not here.
