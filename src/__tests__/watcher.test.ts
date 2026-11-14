/**
 * Real-filesystem tests for startWatcher (no chokidar mocks), so watcher
 * dependency upgrades are caught by the suite instead of by users.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startWatcher } from "../core/watcher.js";
import { consola } from "../utils/console.js";

/** Wait until a counter stops changing for `quietMs`, then return it. */
async function settle(read: () => number, quietMs = 700, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = read();
  for (;;) {
    await new Promise((r) => setTimeout(r, quietMs));
    const now = read();
    if (now === last || Date.now() > deadline) return now;
    last = now;
  }
}

describe("startWatcher (real filesystem)", () => {
  let dir: string;
  let handle: { close: () => Promise<void> } | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "KNARR-watcher-"));
    await mkdir(join(dir, "src", "node_modules"), { recursive: true });
    await writeFile(join(dir, "src", "index.ts"), "export const v = 0;\n");
    vi.spyOn(consola, "info").mockImplementation(() => {});
  });

  afterEach(async () => {
    await handle?.close();
    handle = null;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("debounces a burst of source changes into one onChange call", async () => {
    let calls = 0;
    handle = await startWatcher(
      dir,
      { patterns: ["src"], debounce: 100, cooldown: 0 },
      async () => {
        calls++;
      }
    );

    // The watcher may still be scanning; keep writing until the first event lands.
    let n = 0;
    await vi.waitFor(
      async () => {
        await writeFile(join(dir, "src", "index.ts"), `export const v = ${++n};\n`);
        expect(calls).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 400 }
    );

    const settled = await settle(() => calls);
    // A rapid burst well inside the debounce window must coalesce.
    for (let i = 0; i < 5; i++) {
      await writeFile(join(dir, "src", `burst-${i}.ts`), `export const b = ${i};\n`);
    }
    await vi.waitFor(() => expect(calls).toBe(settled + 1), { timeout: 5_000 });
    await new Promise((r) => setTimeout(r, 500));
    expect(calls).toBe(settled + 1);
  });

  it("ignores changes under node_modules and stops after close()", async () => {
    let calls = 0;
    handle = await startWatcher(
      dir,
      { patterns: ["src"], debounce: 50, cooldown: 0 },
      async () => {
        calls++;
      }
    );

    let n = 0;
    await vi.waitFor(
      async () => {
        await writeFile(join(dir, "src", "index.ts"), `export const v = ${++n};\n`);
        expect(calls).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 400 }
    );
    // Late events from the priming writes can still arrive under load.
    const before = await settle(() => calls);

    await writeFile(join(dir, "src", "node_modules", "dep.js"), "module.exports = 1;\n");
    await new Promise((r) => setTimeout(r, 800));
    expect(calls).toBe(before);

    await handle.close();
    handle = null;
    await writeFile(join(dir, "src", "index.ts"), "export const v = 'closed';\n");
    await new Promise((r) => setTimeout(r, 500));
    expect(calls).toBe(before);
  });
});
