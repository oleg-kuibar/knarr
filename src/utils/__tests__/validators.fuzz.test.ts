import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isAbsolute, join, relative, resolve } from "node:path";
import { validatePackageName } from "../validators.js";

const root = resolve("/consumer/node_modules");

function accepts(name: string): boolean {
  try {
    validatePackageName(name);
    return true;
  } catch {
    return false;
  }
}

const nameLike = fc.oneof(
  fc.string(),
  fc.stringMatching(/^(@[a-z0-9._~\\/-]{0,6}\/)?[a-z0-9._~\\/-]{0,10}$/)
);

describe("validatePackageName (property)", () => {
  it("only accepts names that stay inside node_modules", () => {
    fc.assert(
      fc.property(nameLike, (name) => {
        fc.pre(accepts(name));
        const rel = relative(root, join(root, name));
        expect(rel === "" || rel.startsWith("..") || isAbsolute(rel)).toBe(false);
      }),
      { numRuns: 2000 }
    );
  });
});
