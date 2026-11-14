---
name: knarr-review
description: Parallel review of the current Knarr branch against master. Runs the knarr-reviewer and knarr-docs-checker subagents and merges their findings. Use for PR review or before opening a PR.
argument-hint: "[base-branch or PR number]"
disable-model-invocation: true
---

Review the current branch. Base: `$ARGUMENTS` if given, otherwise `master`. If the argument is a PR number, get its diff with `gh pr diff <n>` and its base with `gh pr view <n> --json baseRefName`.

## Context

- Changed files: !`git diff --stat master...HEAD`
- Uncommitted: !`git status --short`

## Steps

1. Spawn **`knarr-reviewer`** and **`knarr-docs-checker`** in parallel, in one message. Give each the base ref, the changed-file list above, and anything the user said about the intent of the change. Ask each to include uncommitted changes.
2. If the diff touches only docs, `.github/`, or agent files, skip the reviewer and say so.
3. When both return, verify every finding before you report it: open the cited `path:line` and confirm that the scenario can happen. Drop findings you can't confirm, and drop duplicates.
4. Report:
   - **Blocking**: confirmed P0/P1 bugs, most severe first, each with `path:line`, the scenario, and the fix.
   - **Docs gaps**: from the docs checker.
   - **Missing tests**: risky behavior with no test that would catch a regression.
   - **Checked**: one line naming what was reviewed and found fine.
5. Don't edit files. Offer to fix the confirmed findings.
