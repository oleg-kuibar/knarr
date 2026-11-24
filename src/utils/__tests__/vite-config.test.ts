import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addKnarrVitePlugin, isComplexConfig } from "../vite-config.js";

describe("isComplexConfig", () => {
  it("detects ternaries inside defineConfig without scanning with a broad regex", () => {
    expect(
      isComplexConfig("export default defineConfig({ plugins: condition ? [react()] : [] })")
    ).toEqual({ complex: true, reason: "conditional defineConfig" });
  });

  it("ignores question marks in strings inside defineConfig", () => {
    expect(
      isComplexConfig('export default defineConfig({ server: { proxy: "https://example.test?a=1" } })')
    ).toEqual({ complex: false });
  });

  it("ignores optional chaining inside defineConfig", () => {
    expect(
      isComplexConfig("export default defineConfig({ base: env?.PUBLIC_URL })")
    ).toEqual({ complex: false });
  });

  it("ignores nullish coalescing inside defineConfig", () => {
    expect(
      isComplexConfig("export default defineConfig({ server: { port: process.env.PORT ?? 3000 } })")
    ).toEqual({ complex: false });
  });

  it("ignores question marks in line comments inside defineConfig", () => {
    expect(
      isComplexConfig("export default defineConfig({\n  // is this needed?\n  plugins: []\n})")
    ).toEqual({ complex: false });
  });

  it("only scans actual defineConfig calls", () => {
    expect(
      isComplexConfig("const myDefineConfig = () => condition ? a : b;\nexport default defineConfig({ plugins: [] })")
    ).toEqual({ complex: false });
  });
});

describe("addKnarrVitePlugin", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "KNARR-vite-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function rewrite(content: string): Promise<string> {
    const configPath = join(dir, "vite.config.js");
    await writeFile(configPath, content);
    const result = await addKnarrVitePlugin(configPath);
    expect(result).toEqual({ modified: true });
    return readFile(configPath, "utf-8");
  }

  it("formats an empty defineConfig({}) cleanly", async () => {
    const out = await rewrite('import { defineConfig } from "vite";\nexport default defineConfig({});\n');
    expect(out).toBe(
      'import { defineConfig } from "vite";\nimport knarr from "knarr/vite";\n\nexport default defineConfig({\n  plugins: [knarr()],\n});\n'
    );
  });

  it("adds plugins to a non-empty config without touching other keys", async () => {
    const out = await rewrite(
      'import { defineConfig } from "vite";\nexport default defineConfig({\n  server: { port: 3000 },\n});\n'
    );
    expect(out).toContain("defineConfig({\n  plugins: [knarr()],\n  server: { port: 3000 },\n});");
  });

  it("keeps plugin entries on consecutive lines when the config has blank lines", async () => {
    const out = await rewrite(
      'import { defineConfig } from "vite";\n\nexport default defineConfig({\n\n  plugins: [react(), tailwindcss()],\n});\n'
    );
    expect(out).toContain("plugins: [\n    react(),\n    tailwindcss(),\n    knarr(),\n  ],");
  });
});
