# Migrating from yalc

Both tools solve the same problem (local package development), so the migration is mostly mechanical. This page walks through it.

## 60-second migration

```bash
cd my-app
npx knarr migrate
npx knarr use ../my-lib

cd ../my-lib
knarr dev
```

## Key differences

| | yalc | Knarr |
|---|---|---|
| **package.json** | Rewrites deps to `file:.yalc/` | Never touches package.json |
| **Git contamination** | `.yalc/` dir + modified package.json | Everything in gitignored `.knarr/` |
| **Lock file** | `yalc.lock` in project root | `.knarr/state.json` (gitignored) |
| **pnpm support** | Broken since pnpm v7.10 | Works (follows `.pnpm/` symlinks) |
| **Watch mode** | External (yalc-watch, unmaintained) | Built-in (`knarr dev` or `knarr push --watch`) |
| **After npm install** | Manual `yalc link` again | Automatic via `postinstall` hook |
| **Incremental copy** | Full copy every time | Hash-based diff, only changed files |
| **Backup/restore** | No | Yes, original npm version backed up |
| **Git hooks** | Adds pre-push hook to warn | No git hooks |

## Automated migration

Knarr provides a `migrate` command that cleans up yalc artifacts:

```bash
cd my-app
knarr migrate
```

This command:

1. Reads `yalc.lock` to find which packages were linked via yalc
2. Removes `file:.yalc/` references from `package.json` (dependencies, devDependencies, peerDependencies)
3. Deletes the `.yalc/` directory
4. Deletes `yalc.lock`
5. Prints next steps

After running `migrate`, you still need to set up knarr:

```bash
npx knarr use ../my-lib     # publish + link in one step
```

## Manual migration

If you prefer to do it by hand, or if `knarr migrate` does not cover your setup:

### 1. Remove yalc from the consumer project

```bash
# Revert any yalc-added packages
yalc remove --all

# Delete yalc artifacts
rm -rf .yalc yalc.lock
```

Check `package.json` to make sure no `file:.yalc/` references remain. If they do, restore the original version specifiers (e.g., `"my-lib": "^1.0.0"`).

### 2. Restore clean dependencies

```bash
pnpm install    # or npm install / yarn install
```

This gets you back to a clean `node_modules/` with the registry-published versions.

### 3. Set up Knarr

```bash
npx knarr init
```

This creates `.knarr/`, adds it to `.gitignore`, and wires up the `postinstall` hook.

### 4. Publish and link your packages

For each local package you were developing with yalc:

```bash
# In the library directory
cd ../my-lib
pnpm build
knarr publish

# In the consumer directory
cd ../my-app
knarr add my-lib
```

Or in one step:

```bash
cd my-app
npx knarr use ../my-lib
```

### 5. Set up watch mode

Replace your yalc-watch setup with Knarr's built-in watch:

```bash
# Before (yalc)
# Terminal 1: yalc publish --watch  (or yalc-watch)
# Terminal 2: pnpm dev

# After (Knarr)
# Terminal 1:
cd my-lib
knarr dev                                # auto-detects build command

# Terminal 2:
cd my-app
pnpm dev
```

`knarr dev` auto-detects the build command from `package.json` scripts. For explicit control, use `knarr push --watch --build "pnpm build"`.

### 6. Clean up global yalc store (optional)

yalc stores packages in `~/.yalc/`. Once you have confirmed everything works with Knarr, you can delete it:

```bash
rm -rf ~/.yalc
```

## Things Knarr handles differently

### No git hooks

yalc installs a pre-push git hook that warns if yalc packages are linked. Knarr does not add git hooks. Since Knarr never modifies `package.json`, there is nothing dangerous to accidentally commit.

### No package.json modifications

yalc rewrites dependency versions to `file:.yalc/my-lib`. This means `git diff` shows changes, CI might install from the wrong source, and `npm publish` from the consumer can accidentally include the override.

Knarr never touches `package.json`. The real version from the registry stays in your dependency list. Knarr just overwrites the files inside `node_modules/` at runtime.

### postinstall hook

knarr uses a `postinstall` script (`knarr restore || true`) to automatically re-inject linked packages after `npm install` / `pnpm install`. The `|| true` ensures it does not break installs if Knarr is not globally installed.

### Verify with doctor

After migrating, run `knarr doctor` to confirm the setup:

```bash
knarr doctor
```
