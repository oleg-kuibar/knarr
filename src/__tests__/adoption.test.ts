import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { delimiter, join } from "node:path";
import { platform, tmpdir } from "node:os";
import { exists } from "../utils/fs.js";
import { initFlags } from "../utils/logger.js";
import { resetMutations } from "../utils/dry-run.js";

const originalArgv = [...process.argv];
const originalPath = process.env.PATH;

let knarrHome: string;
let testLib: string;
let testConsumer: string;

function setFlags(args: string[] = []): void {
  process.argv = ["node", "knarr", ...args];
  initFlags();
  resetMutations();
}

beforeEach(async () => {
  knarrHome = await mkdtemp(join(tmpdir(), "KNARR-adoption-home-"));
  testLib = await mkdtemp(join(tmpdir(), "KNARR-adoption-lib-"));
  testConsumer = await mkdtemp(join(tmpdir(), "KNARR-adoption-consumer-"));
  process.env.KNARR_HOME = knarrHome;
  process.env.PATH = originalPath;
  setFlags();

  await writeFile(
    join(testConsumer, "package.json"),
    JSON.stringify({ name: "test-app", version: "1.0.0" }, null, 2)
  );
  await writeFile(join(testConsumer, "package-lock.json"), "{}");
  await mkdir(join(testConsumer, "node_modules"), { recursive: true });
});

afterEach(async () => {
  setFlags();
  process.argv = [...originalArgv];
  process.env.PATH = originalPath;
  initFlags();
  resetMutations();
  delete process.env.KNARR_HOME;
  await rm(knarrHome, { recursive: true, force: true });
  await rm(testLib, { recursive: true, force: true });
  await rm(testConsumer, { recursive: true, force: true });
});

describe("build-aware use/add flow", () => {
  it("runs an auto-detected build with --yes before publishing a source path", async () => {
    await writePackage(testLib, {
      scripts: { build: "fake-build" },
    });
    await installFakeNpm();

    const result = await runAddFromConsumer({ from: testLib, yes: true });

    expect(result.buildCmd).toBe("npm run build");
    expect(result.buildRan).toBe(true);
    expect(
      await readFile(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"), "utf-8")
    ).toBe('module.exports = "built";');
  });

  it("runs an explicit build command before publishing", async () => {
    await writePackage(testLib);
    const buildScript = await writeBuildScript("explicit");
    const cmd = `${process.execPath} ${buildScript}`;

    const result = await runAddFromConsumer({
      from: testLib,
      build: cmd,
      yes: true,
    });

    expect(result.buildCmd).toBe(cmd);
    expect(result.buildRan).toBe(true);
    expect(
      await readFile(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"), "utf-8")
    ).toBe('module.exports = "explicit";');
  });

  it("skips build detection when --skip-build is set", async () => {
    await writePackage(testLib, {
      scripts: { build: "fake-build" },
      prebuilt: "prebuilt",
    });

    const result = await runAddFromConsumer({
      from: testLib,
      skipBuild: true,
      yes: true,
    });

    expect(result.buildRan).toBe(false);
    expect(result.buildSkipped).toBe(true);
    expect(
      await readFile(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"), "utf-8")
    ).toBe('module.exports = "prebuilt";');
  });
});

describe("library init adoption defaults", () => {
  it("persists a detected build command to package.json#knarr.buildCmd", async () => {
    await writePackage(testLib, {
      scripts: { build: "tsup" },
    });
    await writeFile(join(testLib, "package-lock.json"), "{}");

    await runInitIn(testLib, { yes: true, role: "library" });

    const pkg = JSON.parse(await readFile(join(testLib, "package.json"), "utf-8"));
    expect(pkg.knarr.buildCmd).toBe("npm run build");
    expect(pkg.scripts["knarr:dev"]).toBe("knarr dev");
  });

  it("does not overwrite an existing Knarr build config", async () => {
    await writePackage(testLib, {
      scripts: { build: "tsup" },
      knarr: { buildCmd: "custom build", debounce: 250 },
    });
    await writeFile(join(testLib, "package-lock.json"), "{}");

    await runInitIn(testLib, { yes: true, role: "library" });

    const pkg = JSON.parse(await readFile(join(testLib, "package.json"), "utf-8"));
    expect(pkg.knarr).toMatchObject({ buildCmd: "custom build", debounce: 250 });
  });
});

describe("yalc migration adoption flow", () => {
  it("cleans up yalc artifacts and links a one-package migration with --from", async () => {
    await writePackage(testLib, { prebuilt: "migrated" });
    await writeYalcConsumer(["test-lib"]);

    const result = await runMigrateIn(testConsumer, {
      yes: true,
      from: testLib,
    });

    expect(result.linkedPackages).toEqual(["test-lib"]);
    expect(await exists(join(testConsumer, ".yalc"))).toBe(false);
    expect(await exists(join(testConsumer, "yalc.lock"))).toBe(false);
    expect(
      await readFile(join(testConsumer, "node_modules", "test-lib", "dist", "index.js"), "utf-8")
    ).toBe('module.exports = "migrated";');
    const pkg = JSON.parse(await readFile(join(testConsumer, "package.json"), "utf-8"));
    expect(pkg.dependencies?.["test-lib"]).toBeUndefined();
  });

  it("keeps dry-run migrations non-mutating", async () => {
    await writePackage(testLib, { prebuilt: "dry" });
    await writeYalcConsumer(["test-lib"]);
    const originalPkg = await readFile(join(testConsumer, "package.json"), "utf-8");
    setFlags(["--dry-run"]);

    const result = await runMigrateIn(testConsumer, {
      yes: true,
      from: testLib,
    });

    expect(result.plannedLinks).toEqual([`knarr add test-lib --from ${testLib}`]);
    expect(result.linkedPackages).toEqual([]);
    expect(await exists(join(testConsumer, ".yalc"))).toBe(true);
    expect(await exists(join(testConsumer, "yalc.lock"))).toBe(true);
    expect(await readFile(join(testConsumer, "package.json"), "utf-8")).toBe(originalPkg);
  });

  it("cleans up multi-package migrations without linking when --yes has no sources", async () => {
    await writeYalcConsumer(["one-lib", "two-lib"]);

    const result = await runMigrateIn(testConsumer, { yes: true });

    expect(result.packages).toEqual(["one-lib", "two-lib"]);
    expect(result.linkedPackages).toEqual([]);
    expect(await exists(join(testConsumer, ".yalc"))).toBe(false);
    expect(await exists(join(testConsumer, "yalc.lock"))).toBe(false);
    const pkg = JSON.parse(await readFile(join(testConsumer, "package.json"), "utf-8"));
    expect(pkg.dependencies?.["one-lib"]).toBeUndefined();
    expect(pkg.dependencies?.["two-lib"]).toBeUndefined();
  });
});

async function runAddFromConsumer(options: {
  from: string;
  build?: string;
  skipBuild?: boolean;
  yes?: boolean;
}) {
  const { addPackageToConsumer, readPackageNameFromSource } = await import("../commands/add-flow.js");
  const originalCwd = process.cwd();
  process.chdir(testConsumer);
  try {
    const packageName = await readPackageNameFromSource(options.from);
    return await addPackageToConsumer({
      packageArg: packageName,
      from: options.from,
      build: options.build,
      skipBuild: options.skipBuild,
      yes: options.yes,
    });
  } finally {
    process.chdir(originalCwd);
  }
}

async function runInitIn(dir: string, args: { yes: boolean; role: string }): Promise<void> {
  const command = await import("../commands/init.js");
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    await command.default.run?.({ args } as any);
  } finally {
    process.chdir(originalCwd);
  }
}

async function runMigrateIn(
  dir: string,
  options: { yes?: boolean; from?: string }
) {
  const { runMigrate } = await import("../commands/migrate.js");
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await runMigrate(options);
  } finally {
    process.chdir(originalCwd);
  }
}

async function writePackage(
  dir: string,
  options: {
    scripts?: Record<string, string>;
    knarr?: Record<string, unknown>;
    prebuilt?: string;
  } = {}
): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "test-lib",
        version: "1.0.0",
        main: "dist/index.js",
        files: ["dist"],
        ...(options.scripts ? { scripts: options.scripts } : {}),
        ...(options.knarr ? { knarr: options.knarr } : {}),
      },
      null,
      2
    )
  );

  if (options.prebuilt) {
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(
      join(dir, "dist", "index.js"),
      `module.exports = "${options.prebuilt}";`
    );
  }
}

async function writeYalcConsumer(packages: string[]): Promise<void> {
  await mkdir(join(testConsumer, ".yalc"), { recursive: true });
  await writeFile(
    join(testConsumer, "yalc.lock"),
    JSON.stringify({
      version: "v1",
      packages: Object.fromEntries(packages.map((name) => [name, { version: "1.0.0" }])),
    })
  );
  await writeFile(
    join(testConsumer, "package.json"),
    JSON.stringify(
      {
        name: "test-app",
        version: "1.0.0",
        dependencies: Object.fromEntries(packages.map((name) => [name, `file:.yalc/${name}`])),
      },
      null,
      2
    )
  );
}

async function installFakeNpm(): Promise<void> {
  const binDir = await mkdtemp(join(tmpdir(), "KNARR-fake-npm-"));
  const buildScript = await writeBuildScript("built");
  const nodePath = process.execPath;

  if (platform() === "win32") {
    await writeFile(
      join(binDir, "npm.cmd"),
      `@echo off\r\n"${nodePath}" "${buildScript}" %*\r\n`
    );
  } else {
    const shim = join(binDir, "npm");
    await writeFile(shim, `#!/bin/sh\nexec "${nodePath}" "${buildScript}" "$@"\n`);
    await chmod(shim, 0o755);
  }

  process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;
}

async function writeBuildScript(value: string): Promise<string> {
  const scriptPath = join(await mkdtemp(join(tmpdir(), "KNARR-build-script-")), "build.mjs");
  await writeFile(
    scriptPath,
    [
      'import { mkdirSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'mkdirSync(join(process.cwd(), "dist"), { recursive: true });',
      `writeFileSync(join(process.cwd(), "dist", "index.js"), 'module.exports = "${value}";');`,
      "",
    ].join("\n")
  );
  return scriptPath;
}
