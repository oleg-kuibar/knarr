import { mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Whether this process can create real symlinks.
 *
 * Windows only allows it with Developer Mode or an elevated shell (GitHub's
 * Windows runners can). Tests that need symlinks use
 * `it.skipIf(!canCreateSymlinks)` so local Windows runs report a skip
 * instead of an EPERM failure.
 */
export const canCreateSymlinks: boolean = await (async () => {
  const dir = await mkdtemp(join(tmpdir(), "KNARR-symlink-probe-"));
  try {
    await symlink(join(dir, "missing"), join(dir, "link"), "dir");
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();
