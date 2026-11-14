import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { devLoopHint, displayPath, knarrCommand } from "../hints.js";

describe("displayPath", () => {
  it("prefers a short relative path", () => {
    const cwd = resolve("/work/app");
    expect(displayPath(resolve("/work/lib"), cwd)).toBe(join("..", "lib"));
  });

  it("returns . for the current directory", () => {
    const cwd = resolve("/work/app");
    expect(displayPath(cwd, cwd)).toBe(".");
  });

  it("quotes paths with spaces", () => {
    const cwd = resolve("/work/app");
    expect(displayPath(resolve("/work/my lib"), cwd)).toBe(`"${join("..", "my lib")}"`);
  });
});

describe("knarrCommand", () => {
  let binDir: string;

  beforeEach(async () => {
    binDir = await mkdtemp(join(tmpdir(), "KNARR-hints-"));
  });

  afterEach(async () => {
    await rm(binDir, { recursive: true, force: true });
  });

  it("uses npx knarr when knarr is not on PATH", () => {
    expect(knarrCommand({ PATH: binDir }, "linux")).toBe("npx knarr");
  });

  it("uses knarr when a global bin is on PATH", async () => {
    await writeFile(join(binDir, "knarr"), "");
    expect(knarrCommand({ PATH: binDir }, "linux")).toBe("knarr");
  });

  it("recognizes Windows shims", async () => {
    await writeFile(join(binDir, "knarr.cmd"), "");
    expect(knarrCommand({ Path: binDir }, "win32")).toBe("knarr");
  });
});

describe("devLoopHint", () => {
  it("suggests dev --all from the workspace root for workspace packages", () => {
    const cwd = resolve("/work/app");
    const hint = devLoopHint(resolve("/work/libs/packages/a"), cwd, resolve("/work/libs"));
    expect(hint).toMatch(new RegExp(`^cd ${join("..", "libs").replaceAll("\\", "\\\\")} && (npx )?knarr dev --all$`));
  });

  it("suggests dev in the package for standalone packages", () => {
    const cwd = resolve("/work/app");
    expect(devLoopHint(resolve("/work/lib"), cwd, null)).toMatch(/ && (npx )?knarr dev$/);
  });
});
