# Security Policy

## Supported versions

Only the latest published version of `knarr` on npm receives security fixes. Fixes ship as patch releases; a fix that needs a breaking change ships in the next minor release while Knarr is 0.x.

## Reporting a vulnerability

**Do not open a public issue or pull request for a vulnerability.**

Report it privately through [GitHub private vulnerability reporting](https://github.com/oleg-kuibar/knarr/security/advisories/new). Include:

- What an attacker can do, and the conditions they need
- Steps to reproduce or a proof of concept
- Affected versions, if known
- A suggested fix, if you have one

What to expect:

| Step | Target |
|---|---|
| Acknowledgement | 3 business days |
| Assessment and severity (CVSS) | 7 days |
| Fix for critical/high severity | 14 days |
| Fix for moderate/low severity | next release |
| Public advisory and CVE | when the fix is published, crediting you unless you prefer otherwise |

Please give us 90 days, or until a fix is released, before disclosing publicly.

## Scope and trust model

Knarr is a local development tool. By design it:

- runs the **build command** and **lifecycle scripts** (`preknarr`, `prepack`, `postpack`, `postknarr`) of the packages you link. Linking a package means trusting its code, as with `npm install`;
- writes only inside the Knarr store (`~/.knarr`, or `KNARR_HOME`), the consumer's `.knarr/`, and the linked package's directory in `node_modules`;
- adds a `postinstall` hook that runs the local, gitignored `.knarr/restore.cjs`. It is a no-op for anyone without `.knarr/`.

In scope, for example:

- writing, deleting, or following links outside those locations (path traversal, symlink or junction escapes)
- running commands or code that the user didn't configure or link
- leaking file contents or credentials, or corrupting the store or consumer state in an exploitable way
- vulnerabilities in the published package or its runtime dependencies

Out of scope: a malicious package you chose to link running code (that is the trust model above), and issues that need an already-compromised machine.

## Supply-chain guarantees

How Knarr itself is built and released:

- **Provenance:** releases are published from GitHub Actions with npm trusted publishing (OIDC, no long-lived token) and `--provenance`. Verify with `npm audit signatures` in a project that depends on `knarr`, or on the package page on npmjs.com.
- **Isolated publishing:** the job that holds the publish credential runs no dependency code. It publishes a tarball built and tested in a separate, read-only job, and checks its SHA-256. Its network egress is limited to the npm registry, Sigstore, and GitHub.
- **Pinned CI:** every GitHub Action is pinned to a full commit SHA. Workflows default to `permissions: {}`, never persist checkout credentials, and are linted by [zizmor](https://docs.zizmor.sh) on every change.
- **Dependencies:** a 7-day release-age cooldown, no dependency install scripts, registry-only transitive dependencies, and `trustPolicy: no-downgrade` (see `pnpm-workspace.yaml`). CI fails on any advisory of any severity, and PRs are blocked from adding vulnerable dependencies or licenses outside the allowlist.
- **Package contents:** CI checks the npm tarball against a file allowlist (`scripts/verify-pack.mjs`).
- **Monitoring:** Dependabot (security and version updates), CodeQL, secret scanning with push protection, and OpenSSF Scorecard.
