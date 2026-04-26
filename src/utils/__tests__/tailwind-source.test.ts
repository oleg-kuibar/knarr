import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findTailwindCss,
  addTailwindSource,
  removeTailwindSource,
} from "../tailwind-source.js";

describe("findTailwindCss", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-tw-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("finds CSS file with @import \"tailwindcss\"", async () => {
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });
    const cssPath = join(srcDir, "app.css");
    await writeFile(cssPath, '@import "tailwindcss";\n\nbody { margin: 0; }\n');

    const result = await findTailwindCss(tempDir);

    expect(result).toBe(cssPath);
  });

  it("finds CSS file with single-quoted import", async () => {
    const cssPath = join(tempDir, "globals.css");
    await writeFile(cssPath, "@import 'tailwindcss';\n");

    const result = await findTailwindCss(tempDir);

    expect(result).toBe(cssPath);
  });

  it("returns null when no Tailwind CSS exists", async () => {
    const cssPath = join(tempDir, "style.css");
    await writeFile(cssPath, "body { color: red; }\n");

    const result = await findTailwindCss(tempDir);

    expect(result).toBeNull();
  });

  it("returns null when directory has no CSS files", async () => {
    const result = await findTailwindCss(tempDir);

    expect(result).toBeNull();
  });

  it("skips node_modules directory", async () => {
    const nmDir = join(tempDir, "node_modules", "some-pkg");
    await mkdir(nmDir, { recursive: true });
    await writeFile(join(nmDir, "style.css"), '@import "tailwindcss";\n');

    const result = await findTailwindCss(tempDir);

    expect(result).toBeNull();
  });
});

describe("addTailwindSource", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-tw-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("adds after @import \"tailwindcss\" line", async () => {
    const cssPath = join(tempDir, "src", "app.css");
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(cssPath, '@import "tailwindcss";\n\nbody { margin: 0; }\n');

    const result = await addTailwindSource(cssPath, "my-lib", tempDir);

    expect(result.modified).toBe(true);
    const content = await readFile(cssPath, "utf-8");
    expect(content).toContain('@source "../node_modules/my-lib";');
    // Should appear after the @import line
    const lines = content.split("\n");
    const importIdx = lines.findIndex((l) => l.includes("@import"));
    const sourceIdx = lines.findIndex((l) => l.includes("@source"));
    expect(sourceIdx).toBe(importIdx + 1);
  });

  it("is idempotent (skip if already present)", async () => {
    const cssPath = join(tempDir, "app.css");
    await writeFile(
      cssPath,
      '@import "tailwindcss";\n@source "../node_modules/my-lib";\n\nbody { margin: 0; }\n',
    );

    const result = await addTailwindSource(cssPath, "my-lib", tempDir);

    expect(result.modified).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("handles scoped package names (@scope/pkg)", async () => {
    const cssDir = join(tempDir, "src");
    await mkdir(cssDir, { recursive: true });
    const cssPath = join(cssDir, "app.css");
    await writeFile(cssPath, '@import "tailwindcss";\n');

    const result = await addTailwindSource(cssPath, "@my-scope/ui-kit", tempDir);

    expect(result.modified).toBe(true);
    const content = await readFile(cssPath, "utf-8");
    expect(content).toContain('@source "../node_modules/@my-scope/ui-kit";');
  });

  it("adds after last directive when multiple @source/@import exist", async () => {
    const cssPath = join(tempDir, "app.css");
    await writeFile(
      cssPath,
      [
        '@import "tailwindcss";',
        '@source "../node_modules/other-pkg";',
        '@plugin "some-plugin";',
        "",
        "body { margin: 0; }",
        "",
      ].join("\n"),
    );

    const result = await addTailwindSource(cssPath, "my-lib", tempDir);

    expect(result.modified).toBe(true);
    const content = await readFile(cssPath, "utf-8");
    const lines = content.split("\n");
    const pluginIdx = lines.findIndex((l) => l.includes("@plugin"));
    const newSourceIdx = lines.findIndex((l) => l.includes("my-lib"));
    expect(newSourceIdx).toBe(pluginIdx + 1);
  });

  it("returns error on missing file", async () => {
    const cssPath = join(tempDir, "nonexistent.css");

    const result = await addTailwindSource(cssPath, "my-lib", tempDir);

    expect(result.modified).toBe(false);
    expect(result.error).toBe("could not read CSS file");
  });

  it("computes correct relative path for nested CSS file", async () => {
    const cssDir = join(tempDir, "src", "styles");
    await mkdir(cssDir, { recursive: true });
    const cssPath = join(cssDir, "app.css");
    await writeFile(cssPath, '@import "tailwindcss";\n');

    const result = await addTailwindSource(cssPath, "my-lib", tempDir);

    expect(result.modified).toBe(true);
    const content = await readFile(cssPath, "utf-8");
    expect(content).toContain('@source "../../node_modules/my-lib";');
  });
});

describe("removeTailwindSource", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "KNARR-test-tw-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("removes the correct @source line", async () => {
    const cssPath = join(tempDir, "app.css");
    await writeFile(
      cssPath,
      '@import "tailwindcss";\n@source "../node_modules/my-lib";\n\nbody { margin: 0; }\n',
    );

    const result = await removeTailwindSource(cssPath, "my-lib");

    expect(result.modified).toBe(true);
    const content = await readFile(cssPath, "utf-8");
    expect(content).not.toContain("my-lib");
    expect(content).toContain('@import "tailwindcss"');
  });

  it("leaves other @source lines intact", async () => {
    const cssPath = join(tempDir, "app.css");
    await writeFile(
      cssPath,
      [
        '@import "tailwindcss";',
        '@source "../node_modules/keep-pkg";',
        '@source "../node_modules/remove-pkg";',
        "",
        "body { margin: 0; }",
        "",
      ].join("\n"),
    );

    const result = await removeTailwindSource(cssPath, "remove-pkg");

    expect(result.modified).toBe(true);
    const content = await readFile(cssPath, "utf-8");
    expect(content).toContain("keep-pkg");
    expect(content).not.toContain("remove-pkg");
  });

  it("handles scoped package names", async () => {
    const cssPath = join(tempDir, "app.css");
    await writeFile(
      cssPath,
      '@import "tailwindcss";\n@source "../node_modules/@my-scope/ui-kit";\n',
    );

    const result = await removeTailwindSource(cssPath, "@my-scope/ui-kit");

    expect(result.modified).toBe(true);
    const content = await readFile(cssPath, "utf-8");
    expect(content).not.toContain("@my-scope/ui-kit");
  });

  it("no-op on missing file", async () => {
    const cssPath = join(tempDir, "nonexistent.css");

    const result = await removeTailwindSource(cssPath, "my-lib");

    expect(result.modified).toBe(false);
  });

  it("no-op when package is not in file", async () => {
    const cssPath = join(tempDir, "app.css");
    await writeFile(cssPath, '@import "tailwindcss";\n');

    const result = await removeTailwindSource(cssPath, "my-lib");

    expect(result.modified).toBe(false);
  });
});
