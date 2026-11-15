import { afterEach, describe, expect, it } from "vitest";
import { pc } from "../colors.js";

const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("pc (util.styleText)", () => {
  it("emits ANSI codes when FORCE_COLOR is set", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    expect(pc.cyan("hi")).toBe("\u001b[36mhi\u001b[39m");
    expect(pc.bold(42)).toBe("\u001b[1m42\u001b[22m");
  });

  it("returns plain text when NO_COLOR is set", () => {
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
    expect(pc.red("plain")).toBe("plain");
    expect(pc.dim(pc.green("nested"))).toBe("nested");
  });
});
