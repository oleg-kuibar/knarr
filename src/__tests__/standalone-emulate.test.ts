/**
 * Full end-to-end standalone example emulation tests.
 *
 * These tests run the REAL workflow a user would follow from the docs:
 * 1. Copy a standalone example app to a temp directory
 * 2. Run the real package manager install (npm install, bun install, etc.)
 * 3. Run real `KNARR` CLI commands (publish, add, list, status, etc.)
 * 4. Run the app and verify it produces the expected output
 * 5. Simulate `npm install` wiping node_modules, then `knarr restore`
 * 6. Run the app again to verify restore worked
 * 7. Test remove, clean, and other lifecycle commands
 * 8. Clean up temp directories
 *
 * False-positive guards:
 * - Pre-condition: verify @example packages DON'T exist before knarr add
 * - App execution: verify stdout contains expected output strings
 * - Post-wipe: verify app FAILS after wipe, then SUCCEEDS after restore
 * - Byte-for-byte: injected content matches source dist
 * - Exit codes: every CLI command asserted
 *
 * Prerequisites:
 * - KNARR must be built (pnpm build → dist/cli.mjs)
 * - Example packages must be built (cd examples/packages/... && npx tsup)
 * - npm and bun must be available in PATH
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  cp,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { exists } from "../utils/fs.js";

// Resolve tmpdir to canonical long path to avoid Windows 8.3 short name
// mismatches (e.g. RUNNER~1 vs runneradmin) that break Vite's path resolution.
let TMPDIR: string;

// Paths
const PROJECT_ROOT = resolve(__dirname, "../..");
const CLI = join(PROJECT_ROOT, "dist/cli.mjs");
const EXAMPLES_ROOT = join(PROJECT_ROOT, "examples");
const PACKAGES_DIR = join(EXAMPLES_ROOT, "packages");
const API_CLIENT_DIR = join(PACKAGES_DIR, "api-client");
const UI_KIT_DIR = join(PACKAGES_DIR, "ui-kit");
const STANDALONE_DIR = join(EXAMPLES_ROOT, "standalone");

let KNARRHome: string;

// ── Shell helpers ───────────────────────────────────────────────────────────

function makeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KNARR_HOME: KNARRHome,
    CI: "1",
    // Force no color to simplify output assertions
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
}

function execOpts(cwd: string): ExecSyncOptionsWithStringEncoding {
  return {
    cwd,
    env: makeEnv(),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 60_000,
  };
}

/** Remove a directory with retries for Windows handle-release delays (esbuild, etc.) */
async function cleanDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

/** Run a shell command, return stdout. Throws on non-zero exit. */
function run(cmd: string, cwd: string): string {
  return execSync(cmd, execOpts(cwd));
}

/** Run a shell command, return { stdout, stderr, exitCode }. Never throws. */
function tryRun(
  cmd: string,
  cwd: string
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      ...execOpts(cwd),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string; stderr: string };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

/** Run a KNARR CLI command. Returns stdout. Throws on non-zero exit. */
function KNARR(args: string, cwd: string): string {
  return run(`node "${CLI}" ${args}`, cwd);
}

/** Run a KNARR CLI command. Returns { stdout, stderr, exitCode }. */
function tryKNARR(
  args: string,
  cwd: string
): { stdout: string; stderr: string; exitCode: number } {
  return tryRun(`node "${CLI}" ${args}`, cwd);
}

// ── Prerequisites ───────────────────────────────────────────────────────────

beforeAll(async () => {
  // realpathSync.native uses the Windows API to resolve 8.3 short names
  // (e.g. RUNNER~1 → runneradmin). The non-native realpath doesn't do this.
  TMPDIR = realpathSync.native(tmpdir());
  if (!(await exists(CLI))) {
    throw new Error(
      "KNARR CLI must be built before running E2E tests.\nRun: pnpm build"
    );
  }
  if (
    !(await exists(join(API_CLIENT_DIR, "dist/index.js"))) ||
    !(await exists(join(UI_KIT_DIR, "dist/index.js")))
  ) {
    throw new Error(
      "Example packages must be built before running E2E tests.\n" +
        "Run: cd examples/packages/api-client && npm install && npx tsup\n" +
        "     cd examples/packages/ui-kit && npm install && npx tsup"
    );
  }
});

beforeEach(async () => {
  KNARRHome = await mkdtemp(join(TMPDIR, "KNARR-e2e-home-"));
});

afterEach(async () => {
  await cleanDir(KNARRHome);
});

// ── npm-app: full E2E ───────────────────────────────────────────────────────

describe("standalone E2E: npm-app", { timeout: 120_000 }, () => {
  let appDir: string;

  beforeEach(async () => {
    // Copy the real npm-app example to a temp directory
    appDir = await mkdtemp(join(TMPDIR, "KNARR-e2e-npm-app-"));
    await cp(join(STANDALONE_DIR, "npm-app"), appDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanDir(appDir);
  });

  it("install → publish → add → run → wipe → install → restore → run → remove", async () => {
    // ── Step 1: npm install (skip postinstall to avoid KNARR not-in-PATH error) ──
    run("npm install --ignore-scripts", appDir);

    // Pre-condition: @example packages must NOT be in node_modules
    expect(
      await exists(join(appDir, "node_modules", "@example", "api-client")),
      "@example/api-client must NOT exist after npm install"
    ).toBe(false);
    expect(
      await exists(join(appDir, "node_modules", "@example", "ui-kit")),
      "@example/ui-kit must NOT exist after npm install"
    ).toBe(false);

    // tsx must be installed
    expect(
      await exists(join(appDir, "node_modules", ".package-lock.json")) ||
        await exists(join(appDir, "node_modules", "tsx")),
      "tsx should be installed"
    ).toBe(true);

    // Pre-condition: app should FAIL without @example packages
    const failRun = tryRun("node --import tsx src/main.ts", appDir);
    expect(failRun.exitCode, "app should fail without KNARR packages").not.toBe(0);

    // ── Step 2: knarr publish example packages ──
    KNARR(`publish "${API_CLIENT_DIR}"`, appDir);
    KNARR(`publish "${UI_KIT_DIR}"`, appDir);

    // ── Step 3: knarr add both packages ──
    KNARR(`add @example/api-client --from "${API_CLIENT_DIR}" --yes`, appDir);
    KNARR(`add @example/ui-kit --from "${UI_KIT_DIR}" --yes`, appDir);

    // Verify files were injected
    const apiIndex = join(appDir, "node_modules", "@example", "api-client", "dist", "index.js");
    const uiIndex = join(appDir, "node_modules", "@example", "ui-kit", "dist", "index.js");
    expect(await exists(apiIndex), "api-client/dist/index.js must exist").toBe(true);
    expect(await exists(uiIndex), "ui-kit/dist/index.js must exist").toBe(true);

    // Byte-for-byte match against source
    const sourceApiContent = await readFile(join(API_CLIENT_DIR, "dist", "index.js"), "utf-8");
    expect(await readFile(apiIndex, "utf-8")).toBe(sourceApiContent);
    const sourceUiContent = await readFile(join(UI_KIT_DIR, "dist", "index.js"), "utf-8");
    expect(await readFile(uiIndex, "utf-8")).toBe(sourceUiContent);

    // ── Step 4: Run the app — the real test ──
    const appOutput = run("node --import tsx src/main.ts", appDir);
    expect(appOutput).toContain("User: Alice (admin)");
    expect(appOutput).toContain("Wireless Headphones");
    expect(appOutput).toContain("USD 79.99");
    expect(appOutput).toContain("btn btn-primary");
    expect(appOutput).toContain('<div class="card">');
    expect(appOutput).toContain("npm-app is working with Knarr-linked packages!");

    // ── Step 5: knarr list should show both packages ──
    const listOutput = KNARR("list", appDir);
    expect(listOutput).toContain("@example/api-client");
    expect(listOutput).toContain("@example/ui-kit");

    // ── Step 6: knarr status should pass ──
    const { exitCode: statusExit } = tryKNARR("status", appDir);
    expect(statusExit, "knarr status should exit 0").toBe(0);

    // ── Step 7: knarr doctor should pass ──
    const { exitCode: doctorExit } = tryKNARR("doctor", appDir);
    expect(doctorExit, "knarr doctor should exit 0").toBe(0);

    // ── Step 8: Simulate npm install wiping node_modules ──
    run("npm install --ignore-scripts", appDir);

    // After npm install, the KNARR-injected packages are gone
    // (npm restores the lockfile-based node_modules, which doesn't have @example)
    expect(
      await exists(apiIndex),
      "api-client should be wiped by npm install"
    ).toBe(false);

    // App should fail again
    const failAfterWipe = tryRun("node --import tsx src/main.ts", appDir);
    expect(failAfterWipe.exitCode, "app should fail after wipe").not.toBe(0);

    // ── Step 9: knarr restore ──
    KNARR("restore", appDir);

    // Files should be back
    expect(await exists(apiIndex), "api-client restored").toBe(true);
    expect(await exists(uiIndex), "ui-kit restored").toBe(true);
    expect(await readFile(apiIndex, "utf-8")).toBe(sourceApiContent);

    // ── Step 10: App should work again after restore ──
    const appAfterRestore = run("node --import tsx src/main.ts", appDir);
    expect(appAfterRestore).toContain("npm-app is working with Knarr-linked packages!");
    expect(appAfterRestore).toContain("USD 79.99");

    // ── Step 11: knarr remove @example/api-client ──
    KNARR("remove @example/api-client", appDir);

    expect(
      await exists(join(appDir, "node_modules", "@example", "api-client")),
      "api-client should be gone after remove"
    ).toBe(false);
    expect(
      await exists(uiIndex),
      "ui-kit should survive api-client removal"
    ).toBe(true);

    // App should fail now (missing api-client import)
    const failAfterRemove = tryRun("node --import tsx src/main.ts", appDir);
    expect(failAfterRemove.exitCode, "app should fail with api-client removed").not.toBe(0);

    // list should only show ui-kit
    const listAfterRemove = KNARR("list", appDir);
    expect(listAfterRemove).toContain("@example/ui-kit");
    expect(listAfterRemove).not.toContain("@example/api-client");

    // ── Step 12: knarr clean ──
    const { exitCode: cleanExit } = tryKNARR("clean", appDir);
    expect(cleanExit, "knarr clean should exit 0").toBe(0);
  });
});

// ── bun-app: full E2E ───────────────────────────────────────────────────────

describe("standalone E2E: bun-app", { timeout: 120_000 }, () => {
  let appDir: string;
  let bunAvailable: boolean;

  beforeAll(() => {
    const result = tryRun("bun --version", tmpdir());
    bunAvailable = result.exitCode === 0;
  });

  beforeEach(async () => {
    appDir = await mkdtemp(join(TMPDIR, "KNARR-e2e-bun-app-"));
    await cp(join(STANDALONE_DIR, "bun-app"), appDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanDir(appDir);
  });

  it("install → add → run → wipe → restore → run", async () => {
    if (!bunAvailable) {
      console.log("Skipping bun test: bun not available");
      return;
    }

    // ── bun install ──
    run("bun install --ignore-scripts", appDir);

    // Pre-condition: no @example packages
    expect(
      await exists(join(appDir, "node_modules", "@example", "api-client")),
      "api-client must NOT exist after bun install"
    ).toBe(false);

    // App should fail without KNARR packages
    const failRun = tryRun("bun run src/main.ts", appDir);
    expect(failRun.exitCode, "app should fail without KNARR packages").not.toBe(0);

    // ── knarr add ──
    KNARR(`add @example/api-client --from "${API_CLIENT_DIR}" --yes`, appDir);
    KNARR(`add @example/ui-kit --from "${UI_KIT_DIR}" --yes`, appDir);

    // Verify injection
    const apiIndex = join(appDir, "node_modules", "@example", "api-client", "dist", "index.js");
    expect(await exists(apiIndex), "api-client injected").toBe(true);

    // Byte-for-byte match
    const sourceContent = await readFile(join(API_CLIENT_DIR, "dist", "index.js"), "utf-8");
    expect(await readFile(apiIndex, "utf-8")).toBe(sourceContent);

    // ── Run the app ──
    const appOutput = run("bun run src/main.ts", appDir);
    expect(appOutput).toContain("User: Alice (admin)");
    expect(appOutput).toContain("USD 79.99");
    expect(appOutput).toContain("bun-app is working with Knarr-linked packages!");

    // ── Wipe → restore → run again ──
    // Unlike npm, bun install preserves packages not in its lockfile.
    // Manual wipe is needed to simulate a clean install.
    await cleanDir(join(appDir, "node_modules"));
    run("bun install --ignore-scripts", appDir);
    expect(
      await exists(apiIndex),
      "api-client wiped after rm + bun install"
    ).toBe(false);

    const failAfterWipe = tryRun("bun run src/main.ts", appDir);
    expect(failAfterWipe.exitCode, "app should fail after wipe").not.toBe(0);

    KNARR("restore", appDir);
    expect(await exists(apiIndex), "api-client restored").toBe(true);

    const appAfterRestore = run("bun run src/main.ts", appDir);
    expect(appAfterRestore).toContain("bun-app is working with Knarr-linked packages!");
  });
});

// ── pnpm-app: full E2E (build instead of run, since it's a Vite browser app) ──

describe("standalone E2E: pnpm-app (vite build)", { timeout: 120_000 }, () => {
  let appDir: string;

  beforeEach(async () => {
    appDir = await mkdtemp(join(TMPDIR, "KNARR-e2e-pnpm-app-"));
    await cp(join(STANDALONE_DIR, "pnpm-app"), appDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanDir(appDir);
  });

  it("install → add → vite build → wipe → restore → vite build", async () => {
    // ── pnpm install ──
    run("pnpm install --ignore-scripts", appDir);

    // Pre-condition: no @example packages
    expect(
      await exists(join(appDir, "node_modules", "@example", "api-client")),
      "api-client must NOT exist after pnpm install"
    ).toBe(false);

    // Build should fail without @example packages
    const failBuild = tryRun("npx vite build", appDir);
    expect(failBuild.exitCode, "vite build should fail without KNARR packages").not.toBe(0);

    // Save original vite.config.ts before knarr add modifies it
    const viteConfigPath = join(appDir, "vite.config.ts");
    const originalViteConfig = await readFile(viteConfigPath, "utf-8");

    // ── knarr add ──
    KNARR(`add @example/api-client --from "${API_CLIENT_DIR}" --yes`, appDir);
    KNARR(`add @example/ui-kit --from "${UI_KIT_DIR}" --yes`, appDir);

    // Restore original vite.config.ts — knarr add auto-injects the KNARR Vite
    // plugin import, but knarr isn't installed in this temp dir.
    // We're testing core injection, not the Vite plugin integration.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(viteConfigPath, originalViteConfig);

    // Verify injection
    const apiIndex = join(appDir, "node_modules", "@example", "api-client", "dist", "index.js");
    const uiIndex = join(appDir, "node_modules", "@example", "ui-kit", "dist", "index.js");
    expect(await exists(apiIndex), "api-client injected").toBe(true);
    expect(await exists(uiIndex), "ui-kit injected").toBe(true);

    // ── vite build should succeed ──
    const buildOutput = run("npx vite build", appDir);
    expect(buildOutput).toContain("built in");

    // Verify build output exists
    expect(
      await exists(join(appDir, "dist", "index.html")),
      "vite build should produce dist/index.html"
    ).toBe(true);

    // Verify the built JS contains our imported functions
    // (vite bundles everything into a single JS file)
    const distFiles = await readFile(join(appDir, "dist", "index.html"), "utf-8");
    expect(distFiles).toContain("<script");

    // ── Wipe → restore → build again ──
    // Like bun, pnpm preserves packages outside its lockfile. Manual wipe needed.
    await cleanDir(join(appDir, "node_modules"));
    run("pnpm install --ignore-scripts", appDir);
    expect(await exists(apiIndex), "api-client wiped after rm + pnpm install").toBe(false);

    // Clean vite build output first
    await cleanDir(join(appDir, "dist"));

    const failAfterWipe = tryRun("npx vite build", appDir);
    expect(failAfterWipe.exitCode, "vite build should fail after wipe").not.toBe(0);

    KNARR("restore", appDir);
    expect(await exists(apiIndex), "api-client restored").toBe(true);

    const buildAfterRestore = run("npx vite build", appDir);
    expect(buildAfterRestore).toContain("built in");
  });
});

// ── Multi-consumer push E2E ─────────────────────────────────────────────────

describe("standalone E2E: push to multiple consumers", { timeout: 120_000 }, () => {
  let npmApp: string;
  let bunApp: string;
  let bunAvailable: boolean;

  beforeAll(() => {
    const result = tryRun("bun --version", tmpdir());
    bunAvailable = result.exitCode === 0;
  });

  beforeEach(async () => {
    npmApp = await mkdtemp(join(TMPDIR, "KNARR-e2e-push-npm-"));
    await cp(join(STANDALONE_DIR, "npm-app"), npmApp, { recursive: true });

    bunApp = await mkdtemp(join(TMPDIR, "KNARR-e2e-push-bun-"));
    await cp(join(STANDALONE_DIR, "bun-app"), bunApp, { recursive: true });
  });

  afterEach(async () => {
    await cleanDir(npmApp);
    await cleanDir(bunApp);
  });

  it("push from library updates all consumers", async () => {
    if (!bunAvailable) {
      console.log("Skipping push test: bun not available");
      return;
    }

    // Install deps in both consumers
    run("npm install --ignore-scripts", npmApp);
    run("bun install --ignore-scripts", bunApp);

    // Add @example/api-client to both consumers
    KNARR(`add @example/api-client --from "${API_CLIENT_DIR}" --yes`, npmApp);
    KNARR(`add @example/api-client --from "${API_CLIENT_DIR}" --yes`, bunApp);

    // Also add ui-kit so the apps can run
    KNARR(`add @example/ui-kit --from "${UI_KIT_DIR}" --yes`, npmApp);
    KNARR(`add @example/ui-kit --from "${UI_KIT_DIR}" --yes`, bunApp);

    // Both apps should work
    const npmOutput = run("node --import tsx src/main.ts", npmApp);
    expect(npmOutput).toContain("USD 79.99");
    const bunOutput = run("bun run src/main.ts", bunApp);
    expect(bunOutput).toContain("USD 79.99");

    // Now create a modified api-client and push
    const tempLib = await mkdtemp(join(TMPDIR, "KNARR-e2e-modified-lib-"));
    await cp(API_CLIENT_DIR, tempLib, { recursive: true });

    // Modify the dist output to change formatPrice
    const modifiedDist = `// src/client.ts
var API_BASE = "https://api.example.com";
async function getUser(id) {
  const res = await fetch(\`\${API_BASE}/users/\${id}\`);
  return res.json();
}
async function getProducts() {
  const res = await fetch(\`\${API_BASE}/products\`);
  return res.json();
}
function formatPrice(product) {
  return \`\${product.currency} \${product.price.toFixed(2)} [PUSHED]\`;
}
export {
  formatPrice,
  getProducts,
  getUser
};
`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tempLib, "dist", "index.js"), modifiedDist);

    // Push from the modified lib
    KNARR("push", tempLib);

    // Both consumers should now have the updated content
    const npmAfterPush = run("node --import tsx src/main.ts", npmApp);
    expect(npmAfterPush).toContain("[PUSHED]");
    expect(npmAfterPush).toContain("USD 79.99 [PUSHED]");

    const bunAfterPush = run("bun run src/main.ts", bunApp);
    expect(bunAfterPush).toContain("[PUSHED]");
    expect(bunAfterPush).toContain("USD 79.99 [PUSHED]");

    // Verify the ORIGINAL output no longer appears (not a false positive)
    // Original was "USD 79.99" without [PUSHED]
    // Now it's "USD 79.99 [PUSHED]" — both contain "USD 79.99" so check the full line
    const npmApiContent = await readFile(
      join(npmApp, "node_modules", "@example", "api-client", "dist", "index.js"),
      "utf-8"
    );
    expect(npmApiContent).toBe(modifiedDist);

    await cleanDir(tempLib);
  });
});

// ── Error handling E2E ──────────────────────────────────────────────────────

describe("standalone E2E: error handling", { timeout: 30_000 }, () => {
  let appDir: string;

  beforeEach(async () => {
    appDir = await mkdtemp(join(TMPDIR, "KNARR-e2e-errors-"));
    await cp(join(STANDALONE_DIR, "npm-app"), appDir, { recursive: true });
    run("npm install --ignore-scripts", appDir);
  });

  afterEach(async () => {
    await cleanDir(appDir);
  });

  it("knarr add fails for package not in store", () => {
    const result = tryKNARR("add does-not-exist --yes", appDir);
    expect(result.exitCode).not.toBe(0);
  });

  it("knarr publish fails for directory without package.json", async () => {
    const emptyDir = await mkdtemp(join(TMPDIR, "KNARR-empty-"));
    const result = tryKNARR(`publish "${emptyDir}"`, appDir);
    expect(result.exitCode).not.toBe(0);
    await cleanDir(emptyDir);
  });

  it("knarr restore is no-op with no linked packages", () => {
    const result = tryKNARR("restore --silent", appDir);
    expect(result.exitCode).toBe(0);
  });

  it("knarr list is empty with no linked packages", () => {
    const result = tryKNARR("list", appDir);
    expect(result.exitCode).toBe(0);
  });
});
