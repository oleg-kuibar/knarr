import { describe, expect, it } from "vitest";
import { isComplexConfig } from "../vite-config.js";

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
