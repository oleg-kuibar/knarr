import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stdin } from "node:process";
import { consola } from "../console.js";

// Under vitest stdin is not a TTY: exactly the CI / script / agent case.
describe("consola.prompt without a TTY", () => {
  let stderr: string[];
  const originalIsTTY = stdin.isTTY;

  beforeEach(() => {
    Object.defineProperty(stdin, "isTTY", { value: undefined, configurable: true });
    stderr = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      stderr.push(args.join(" "));
    });
  });

  afterEach(() => {
    Object.defineProperty(stdin, "isTTY", { value: originalIsTTY, configurable: true });
    vi.restoreAllMocks();
  });

  it("answers a confirm with its declared default and says so on stderr", async () => {
    await expect(
      consola.prompt("Run build?", { type: "confirm", initial: true })
    ).resolves.toBe(true);
    await expect(
      consola.prompt("Overwrite?", { type: "confirm", initial: false })
    ).resolves.toBe(false);
    expect(stderr.join("\n")).toMatch(/Run build\?.*yes.*no interactive terminal/);
  });

  it("returns the default for text prompts", async () => {
    await expect(
      consola.prompt("Build command:", { type: "text", default: "tsup" })
    ).resolves.toBe("tsup");
    await expect(consola.prompt("Name:", { type: "text" })).resolves.toBe("");
  });

  it("exits 1 with a --yes hint for confirms without a safe default", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }));

    await expect(
      consola.prompt("Reset Knarr?", { type: "confirm" })
    ).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr.join("\n")).toContain("--yes");
  });

  it("exits 1 for selects and shows the command-specific hint", async () => {
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }));

    await expect(
      consola.prompt("Role?", {
        type: "select",
        options: [{ label: "a", value: "a" }],
        nonInteractiveHint: "Pass --role consumer.",
      })
    ).rejects.toThrow("exit");
    expect(stderr.join("\n")).toContain("Pass --role consumer.");
  });
});
