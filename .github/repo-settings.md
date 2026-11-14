# Repository security settings

GitHub settings that back up the in-repo rules (`SECURITY.md`, workflows, `pnpm-workspace.yaml`). They live in GitHub, not in git, so this file records them. Update it whenever a setting changes.

## Applied

| Area | Setting |
|---|---|
| Actions | Only GitHub-owned actions plus `pnpm/action-setup`, `oven-sh/setup-bun`, `step-security/harden-runner`, `ossf/scorecard-action`, `zizmorcore/zizmor-action`. Every action must be pinned to a full commit SHA. Default `GITHUB_TOKEN` is read-only and can't approve PRs. |
| Forks | Workflows from any outside contributor wait for maintainer approval. |
| `master` ruleset | No deletion or force-push. Linear history. PRs with 1 approval, last-push approval, stale-review dismissal, resolved threads, and code-owner review (`.github/CODEOWNERS`). Required status checks (strict). CodeQL gates high or higher alerts. Admins can bypass only through a PR; there is no deploy-key bypass. |
| `npm` environment | Protected branches only, and every deployment waits for approval from @oleg-kuibar. |
| Scanning | Secret scanning and push protection, Dependabot security updates, CodeQL default setup, private vulnerability reporting. The CodeQL extended query suite was requested on 2026-11-14 and applies when GitHub's CodeQL setup run finishes. Check with `gh api repos/oleg-kuibar/knarr/code-scanning/default-setup --jq .query_suite`. |

Not available on this personal account: generic-pattern secret scanning and secret validity checks. They need GitHub Secret Protection. The API accepts the request but leaves both disabled.

## Pending: after the hardened workflows merge

Make the new checks required. Do this after merging: open PRs based on the old workflows would never report them and would stay blocked.

```bash
R=oleg-kuibar/knarr
id=$(gh api repos/$R/rulesets --jq '.[] | select(.name=="master-protection") | .id')
gh api repos/$R/rulesets/$id > ruleset.json
node -e '
  const r = JSON.parse(require("fs").readFileSync("ruleset.json", "utf8"));
  const checks = [];
  for (const os of ["ubuntu-latest", "windows-latest", "macos-latest"])
    for (const node of [22, 24, 26]) checks.push(`test (${os}, ${node})`);
  checks.push("dependency audit", "compat smoke", "zizmor", "dependency review");
  const rules = r.rules.map((x) => x.type !== "required_status_checks" ? x : {
    ...x, parameters: { ...x.parameters,
      required_status_checks: checks.map((context) => ({ context, integration_id: 15368 })) } });
  const body = { name: r.name, target: r.target, enforcement: r.enforcement,
    conditions: r.conditions, bypass_actors: r.bypass_actors, rules };
  require("fs").writeFileSync("ruleset.json", JSON.stringify(body));'
gh api -X PUT repos/$R/rulesets/$id --input ruleset.json
```

## Next: signed commits

Set up SSH commit signing, add the key on GitHub as a **Signing key**, then add a `required_signatures` rule to the ruleset once your commits show as Verified:

```bash
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

## Rollback

A snapshot of the settings before hardening (2026-11-14) is in the maintainer's local session. Each setting can also be reverted under Settings → Actions, Rules, Environments, and Code security.
