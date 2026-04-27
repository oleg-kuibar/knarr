import { describe, it, expect } from "vitest";
import {
  encodePackageName,
  decodePackageName,
  getNodeModulesPackagePath,
  getStoreEntryPath,
} from "../paths.js";

describe("encodePackageName", () => {
  it("encodes scoped package names", () => {
    expect(encodePackageName("@scope/name")).toBe("@scope+name");
  });

  it("leaves unscoped names unchanged", () => {
    expect(encodePackageName("my-lib")).toBe("my-lib");
  });

  it("rejects traversal and separator input", () => {
    expect(() => encodePackageName("../evil")).toThrow("Invalid package name");
    expect(() => encodePackageName("scope\\evil")).toThrow("Invalid package name");
  });
});

describe("decodePackageName", () => {
  it("decodes scoped package names", () => {
    expect(decodePackageName("@scope+name")).toBe("@scope/name");
  });

  it("leaves unscoped names unchanged", () => {
    expect(decodePackageName("my-lib")).toBe("my-lib");
  });
});

describe("path helpers", () => {
  it("rejects invalid package versions in store paths", () => {
    expect(() => getStoreEntryPath("my-lib", "../1.0.0")).toThrow(
      "Invalid package version"
    );
  });

  it("rejects package names that would escape node_modules", () => {
    expect(() => getNodeModulesPackagePath("/tmp/app", "@scope/../pkg")).toThrow(
      "Invalid package name"
    );
  });
});
