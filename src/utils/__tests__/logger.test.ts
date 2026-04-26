import { describe, it, expect, vi } from "vitest";
import { isVerbose, isDryRun, isJsonOutput, verbose } from "../logger.js";

// Mock console to verify verbose() behavior
vi.mock("../console.js", () => ({
  consola: {
    level: 3,
    debug: vi.fn(),
  },
}));

describe("logger default states", () => {
  it("isVerbose() returns false by default", () => {
    expect(isVerbose()).toBe(false);
  });

  it("isDryRun() returns false by default", () => {
    expect(isDryRun()).toBe(false);
  });

  it("isJsonOutput() returns false by default", () => {
    expect(isJsonOutput()).toBe(false);
  });
});

describe("verbose()", () => {
  it("does not call consola.debug when verbose is not active", async () => {
    const { consola } = await import("../console.js");
    vi.mocked(consola.debug).mockClear();

    verbose("test message", "arg1");

    expect(consola.debug).not.toHaveBeenCalled();
  });
});
