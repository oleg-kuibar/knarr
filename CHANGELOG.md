# Changelog

## 0.0.3

- Keep auto-installed setup dependencies from pruning freshly linked packages.
- Expose plugin entry points to CommonJS config files used by Webpack and rspack.

## 0.0.2

- Validate package names and versions before deriving store or consumer paths.
- Honor dry-run mode for setup, migration, copy, and install mutations.
- Preserve live store entries when publish or rollback swaps fail.
- Reuse resolved build commands for cascading workspace rebuilds.
- Fix generated Windows `.cmd` bin wrappers to invoke Node.

## 0.0.1

- Initial Knarr release.
