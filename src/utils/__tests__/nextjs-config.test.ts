import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  addToTranspilePackages,
  removeFromTranspilePackages,
} from "../nextjs-config.js";

describe("addToTranspilePackages", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("adds to existing transpilePackages array", async () => {
    const configPath = join(tempDir, "next.config.js");
    await writeFile(
      configPath,
      `module.exports = {\n  transpilePackages: ['existing-pkg'],\n};\n`
    );

    const result = await addToTranspilePackages(configPath, "new-pkg");

    expect(result.modified).toBe(true);
    const content = await readFile(configPath, "utf-8");
    expect(content).toContain("existing-pkg");
    expect(content).toContain("new-pkg");
  });

  it("skips if package is already present", async () => {
    const configPath = join(tempDir, "next.config.js");
    await writeFile(
      configPath,
      `module.exports = {\n  transpilePackages: ['my-pkg'],\n};\n`
    );

    const result = await addToTranspilePackages(configPath, "my-pkg");

    expect(result.modified).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("adds when no transpilePackages exists (module.exports = {})", async () => {
    const configPath = join(tempDir, "next.config.js");
    await writeFile(configPath, `module.exports = {\n  reactStrictMode: true,\n};\n`);

    const result = await addToTranspilePackages(configPath, "my-pkg");

    expect(result.modified).toBe(true);
    const content = await readFile(configPath, "utf-8");
    expect(content).toContain("transpilePackages");
    expect(content).toContain("my-pkg");
  });

  it("adds when no transpilePackages exists (export default {})", async () => {
    const configPath = join(tempDir, "next.config.mjs");
    await writeFile(configPath, `export default {\n  reactStrictMode: true,\n};\n`);

    const result = await addToTranspilePackages(configPath, "my-pkg");

    expect(result.modified).toBe(true);
    const content = await readFile(configPath, "utf-8");
    expect(content).toContain("transpilePackages");
    expect(content).toContain("my-pkg");
  });

  it("returns error for missing config file", async () => {
    const configPath = join(tempDir, "nonexistent.config.js");

    const result = await addToTranspilePackages(configPath, "my-pkg");

    expect(result.modified).toBe(false);
    expect(result.error).toBe("could not read config file");
  });
});

describe("removeFromTranspilePackages", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("removes a package from the array", async () => {
    const configPath = join(tempDir, "next.config.js");
    await writeFile(
      configPath,
      `module.exports = {\n  transpilePackages: ['keep-pkg', 'remove-pkg'],\n};\n`
    );

    const result = await removeFromTranspilePackages(configPath, "remove-pkg");

    expect(result.modified).toBe(true);
    const content = await readFile(configPath, "utf-8");
    expect(content).toContain("keep-pkg");
    expect(content).not.toContain("remove-pkg");
  });

  it("removes the last item from the array", async () => {
    const configPath = join(tempDir, "next.config.js");
    await writeFile(
      configPath,
      `module.exports = {\n  transpilePackages: ['only-pkg'],\n};\n`
    );

    const result = await removeFromTranspilePackages(configPath, "only-pkg");

    expect(result.modified).toBe(true);
    const content = await readFile(configPath, "utf-8");
    expect(content).toContain("transpilePackages: []");
    expect(content).not.toContain("only-pkg");
  });

  it("returns not modified for missing config file", async () => {
    const configPath = join(tempDir, "nonexistent.config.js");

    const result = await removeFromTranspilePackages(configPath, "my-pkg");

    expect(result.modified).toBe(false);
  });
});
