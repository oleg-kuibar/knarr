import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { resolvePackFiles } from "../pack-list.js";
import type { PackageJson } from "../../types.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "KNARR-pack-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("resolvePackFiles", () => {
  it("always includes package.json", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    const files = await resolvePackFiles(tempDir, pkg);
    expect(files.some((f) => f.endsWith("package.json"))).toBe(true);
  });

  it("uses files field when present", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await mkdir(join(tempDir, "dist"), { recursive: true });
    await writeFile(join(tempDir, "dist", "index.js"), "");
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src", "index.ts"), "");

    const pkg: PackageJson = { name: "test", version: "1.0.0", files: ["dist"] };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.replace(tempDir + "\\", "").replace(tempDir + "/", ""));

    expect(rels).toContainEqual(expect.stringContaining("dist"));
    // src/ should NOT be included since files only says dist
    expect(rels.every((r) => !r.startsWith("src"))).toBe(true);
  });

  it("includes README.md and LICENSE even with files field", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "README.md"), "# hello");
    await writeFile(join(tempDir, "LICENSE"), "MIT");
    await mkdir(join(tempDir, "dist"), { recursive: true });
    await writeFile(join(tempDir, "dist", "index.js"), "");

    const pkg: PackageJson = { name: "test", version: "1.0.0", files: ["dist"] };
    const files = await resolvePackFiles(tempDir, pkg);

    expect(files.some((f) => f.endsWith("README.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("LICENSE"))).toBe(true);
  });

  it("deduplicates files", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await mkdir(join(tempDir, "dist"), { recursive: true });
    await writeFile(join(tempDir, "dist", "index.js"), "");

    // files field includes dist and explicit dist/index.js (overlap)
    const pkg: PackageJson = {
      name: "test",
      version: "1.0.0",
      files: ["dist", "dist/index.js"],
    };
    const files = await resolvePackFiles(tempDir, pkg);
    const unique = new Set(files);
    expect(files.length).toBe(unique.size);
  });

  it("ignores default directories when no files field", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "index.js"), "");
    await mkdir(join(tempDir, "node_modules", "dep"), { recursive: true });
    await writeFile(join(tempDir, "node_modules", "dep", "x.js"), "");
    await mkdir(join(tempDir, "test"), { recursive: true });
    await writeFile(join(tempDir, "test", "spec.js"), "");
    await mkdir(join(tempDir, ".git"), { recursive: true });
    await writeFile(join(tempDir, ".git", "config"), "");

    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    expect(rels).not.toContainEqual(expect.stringContaining("node_modules/"));
    expect(rels).not.toContainEqual(expect.stringContaining("test/"));
    expect(rels).not.toContainEqual(expect.stringContaining(".git/"));
  });

  it("respects .npmignore when no files field", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "index.js"), "");
    await writeFile(join(tempDir, "secret.js"), "");
    await writeFile(join(tempDir, ".npmignore"), "# Comment\nsecret.js\n");

    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    const files = await resolvePackFiles(tempDir, pkg);

    expect(files.some((f) => f.endsWith("index.js"))).toBe(true);
    expect(files.some((f) => f.endsWith("secret.js"))).toBe(false);
  });

  it("skips non-existent paths in files field", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");

    const pkg: PackageJson = {
      name: "test",
      version: "1.0.0",
      files: ["does-not-exist", "also-missing"],
    };
    const files = await resolvePackFiles(tempDir, pkg);
    // Should still include package.json at minimum
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("handles files field with single files (not directories)", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "index.js"), "exports");

    const pkg: PackageJson = {
      name: "test",
      version: "1.0.0",
      files: ["index.js"],
    };
    const files = await resolvePackFiles(tempDir, pkg);
    expect(files.some((f) => f.endsWith("index.js"))).toBe(true);
  });

  it("resolves glob patterns in files field", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await mkdir(join(tempDir, "dist"), { recursive: true });
    await writeFile(join(tempDir, "dist", "index.js"), "");
    await writeFile(join(tempDir, "dist", "utils.js"), "");
    await writeFile(join(tempDir, "dist", "types.d.ts"), "");
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src", "index.ts"), "");

    const pkg: PackageJson = {
      name: "test",
      version: "1.0.0",
      files: ["dist/**/*.js"],
    };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    expect(rels).toContain("dist/index.js");
    expect(rels).toContain("dist/utils.js");
    expect(rels).not.toContain("dist/types.d.ts");
    expect(rels).not.toContain("src/index.ts");
  });

  it("resolves dist/** glob to include all files", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await mkdir(join(tempDir, "dist", "sub"), { recursive: true });
    await writeFile(join(tempDir, "dist", "index.js"), "");
    await writeFile(join(tempDir, "dist", "sub", "helper.js"), "");

    const pkg: PackageJson = {
      name: "test",
      version: "1.0.0",
      files: ["dist/**"],
    };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    expect(rels).toContain("dist/index.js");
    expect(rels).toContain("dist/sub/helper.js");
  });

  it("respects .npmignore glob patterns", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "index.js"), "");
    await writeFile(join(tempDir, "index.test.js"), "");
    await writeFile(join(tempDir, "utils.test.js"), "");
    await writeFile(join(tempDir, ".npmignore"), "*.test.js\n");

    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    const files = await resolvePackFiles(tempDir, pkg);

    expect(files.some((f) => f.endsWith("index.js"))).toBe(true);
    expect(files.some((f) => f.endsWith("index.test.js"))).toBe(false);
    expect(files.some((f) => f.endsWith("utils.test.js"))).toBe(false);
  });

  it("handles .npmignore negation patterns", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await mkdir(join(tempDir, "lib"), { recursive: true });
    await writeFile(join(tempDir, "lib", "a.js"), "");
    await writeFile(join(tempDir, "lib", "important.js"), "");
    await writeFile(join(tempDir, ".npmignore"), "lib\n!lib/important.js\n");

    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    expect(rels).not.toContain("lib/a.js");
    expect(rels).toContain("lib/important.js");
  });

  it("negation patterns override DEFAULT_IGNORES", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "index.js"), "");
    await mkdir(join(tempDir, "test", "fixtures"), { recursive: true });
    await writeFile(join(tempDir, "test", "spec.js"), "");
    await writeFile(join(tempDir, "test", "fixtures", "data.json"), "{}");
    await writeFile(join(tempDir, ".npmignore"), "test\n!test/fixtures/**\n");

    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    expect(rels).toContain("index.js");
    expect(rels).not.toContain("test/spec.js");
    expect(rels).toContain("test/fixtures/data.json");
  });

  it("rejects files patterns that escape package directory via ../", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await mkdir(join(tempDir, "dist"), { recursive: true });
    await writeFile(join(tempDir, "dist", "index.js"), "");

    const pkg: PackageJson = {
      name: "test",
      version: "1.0.0",
      files: ["../../etc/passwd", "dist"],
    };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    // The traversal pattern should be skipped
    expect(rels.some((r) => r.includes("etc"))).toBe(false);
    expect(rels.some((r) => r.includes("passwd"))).toBe(false);
    // But dist should still be included
    expect(rels).toContain("dist/index.js");
  });

  // Symlink tests only work reliably on non-Windows (Windows needs SeCreateSymbolicLinkPrivilege)
  it.skipIf(platform() === "win32")("excludes symlinks pointing outside package directory", async () => {
    // Create a file outside the package
    const outsideDir = await mkdtemp(join(tmpdir(), "KNARR-outside-"));
    await writeFile(join(outsideDir, "secret.txt"), "secret data");

    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "legit.js"), "ok");

    // Create a symlink inside the package pointing outside
    await symlink(join(outsideDir, "secret.txt"), join(tempDir, "escaped.txt"));

    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    expect(rels).toContain("legit.js");
    expect(rels).not.toContain("escaped.txt");

    await rm(outsideDir, { recursive: true, force: true });
  });

  it.skipIf(platform() === "win32")("excludes symlinked directories", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "KNARR-outside-"));
    await mkdir(join(outsideDir, "data"), { recursive: true });
    await writeFile(join(outsideDir, "data", "secret.txt"), "secret");

    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "legit.js"), "ok");

    // Create a symlinked directory
    await symlink(join(outsideDir, "data"), join(tempDir, "linked-dir"));

    const pkg: PackageJson = { name: "test", version: "1.0.0" };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    expect(rels).toContain("legit.js");
    expect(rels.some((r) => r.includes("linked-dir"))).toBe(false);
    expect(rels.some((r) => r.includes("secret"))).toBe(false);

    await rm(outsideDir, { recursive: true, force: true });
  });

  it("includes nested node_modules when files field is set", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await mkdir(join(tempDir, "dist", "node_modules", "polyfill"), { recursive: true });
    await writeFile(join(tempDir, "dist", "index.js"), "");
    await writeFile(join(tempDir, "dist", "node_modules", "polyfill", "index.js"), "");

    const pkg: PackageJson = { name: "test", version: "1.0.0", files: ["dist"] };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    expect(rels).toContain("dist/index.js");
    expect(rels).toContain("dist/node_modules/polyfill/index.js");
  });

  it("still excludes top-level node_modules", async () => {
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, "index.js"), "");
    await mkdir(join(tempDir, "node_modules", "dep"), { recursive: true });
    await writeFile(join(tempDir, "node_modules", "dep", "x.js"), "");
    await mkdir(join(tempDir, "dist", "node_modules", "polyfill"), { recursive: true });
    await writeFile(join(tempDir, "dist", "node_modules", "polyfill", "index.js"), "");

    const pkg: PackageJson = { name: "test", version: "1.0.0", files: ["dist", "index.js"] };
    const files = await resolvePackFiles(tempDir, pkg);
    const rels = files.map((f) => f.slice(tempDir.length + 1).replace(/\\/g, "/"));

    // Top-level node_modules excluded (not in files field)
    expect(rels.some((r) => r.startsWith("node_modules/"))).toBe(false);
    // Nested node_modules included
    expect(rels).toContain("dist/node_modules/polyfill/index.js");
  });
});
