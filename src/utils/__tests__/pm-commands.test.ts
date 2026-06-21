import { describe, expect, it } from "vitest";
import type { PackageManager } from "../../types.js";
import {
  buildDevInstallCommand,
  buildInstallCommand,
} from "../pm-commands.js";

describe("package manager command builders", () => {
  it.each([
    ["npm", "npm install react @scope/ui-kit"],
    ["pnpm", "pnpm add react @scope/ui-kit"],
    ["yarn", "yarn add react @scope/ui-kit"],
    ["bun", "bun add react @scope/ui-kit"],
  ] satisfies [PackageManager, string][])(
    "builds dependency install commands for %s",
    (pm, expected) => {
      expect(buildInstallCommand(pm, ["react", "@scope/ui-kit"])).toBe(expected);
    }
  );

  it.each([
    ["npm", "npm install -D knarr"],
    ["pnpm", "pnpm add -D knarr"],
    ["yarn", "yarn add -D knarr"],
    ["bun", "bun add -d knarr"],
  ] satisfies [PackageManager, string][])(
    "builds dev dependency install commands for %s",
    (pm, expected) => {
      expect(buildDevInstallCommand(pm, "knarr")).toBe(expected);
    }
  );

  it("rejects unsafe dependency names before building install commands", () => {
    expect(() => buildInstallCommand("npm", ["left-pad && rm -rf /"])).toThrow(
      "Invalid package name"
    );
  });

  it("rejects empty dependency lists", () => {
    expect(() => buildInstallCommand("npm", [])).toThrow(
      "No dependencies provided"
    );
  });

  it("rejects unsafe dev dependency names", () => {
    expect(() => buildDevInstallCommand("pnpm", "../knarr")).toThrow(
      "Invalid package name"
    );
  });
});
