import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("package exports", () => {
  it("exposes plugin entry points to CommonJS config files", async () => {
    const pkg = JSON.parse(
      await readFile(resolve(__dirname, "../../../package.json"), "utf-8")
    );

    expect(pkg.exports["./webpack"].require).toBe("./dist/webpack-plugin.mjs");
    expect(pkg.exports["./vite"].require).toBe("./dist/vite-plugin.mjs");
  });
});
