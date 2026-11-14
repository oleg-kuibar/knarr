import { describe, expect, it } from "vitest";
import {
  asPackageJson,
  detectJsonIndent,
  objectField,
  parseJsonObject,
  stringField,
  stringRecordField,
} from "../json.js";

describe("json helpers", () => {
  it("parseJsonObject rejects arrays and primitives", () => {
    expect(() => parseJsonObject("[]", "package.json")).toThrow("package.json must contain a JSON object");
    expect(() => parseJsonObject("42")).toThrow();
    expect(() => parseJsonObject("null")).toThrow();
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("keeps a __proto__ key as plain data", () => {
    const obj = parseJsonObject('{"__proto__": {"polluted": true}}');
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(objectField(obj, "__proto__")).toEqual({ polluted: true });
  });

  it("field helpers only return values of the expected type", () => {
    const obj = parseJsonObject('{"s":"x","n":1,"o":{"a":"b","c":2},"arr":[1]}');
    expect(stringField(obj, "s")).toBe("x");
    expect(stringField(obj, "n")).toBeUndefined();
    expect(objectField(obj, "o")).toEqual({ a: "b", c: 2 });
    expect(objectField(obj, "arr")).toBeUndefined();
    expect({ ...stringRecordField(obj, "o") }).toEqual({ a: "b" });
    expect({ ...stringRecordField(obj, "missing") }).toEqual({});
  });

  it("asPackageJson requires string name and version", () => {
    expect(asPackageJson(parseJsonObject('{"name":"a","version":"1.0.0"}'))?.name).toBe("a");
    expect(asPackageJson(parseJsonObject('{"name":1,"version":"1.0.0"}'))).toBeNull();
    expect(asPackageJson(parseJsonObject('{"name":"a"}'))).toBeNull();
  });

  it("detects indentation", () => {
    expect(detectJsonIndent('{\n    "a": 1\n}')).toBe("    ");
    expect(detectJsonIndent("{}")).toBe("  ");
  });
});
