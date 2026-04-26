import { describe, it, expect } from "vitest";
import {
  encodePackageName,
  decodePackageName,
} from "../paths.js";

describe("encodePackageName", () => {
  it("encodes scoped package names", () => {
    expect(encodePackageName("@scope/name")).toBe("@scope+name");
  });

  it("leaves unscoped names unchanged", () => {
    expect(encodePackageName("my-lib")).toBe("my-lib");
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
