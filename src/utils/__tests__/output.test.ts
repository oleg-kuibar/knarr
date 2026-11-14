import { afterEach, describe, expect, it, vi } from "vitest";
import { output } from "../output.js";
import { printDryRunReport, recordMutation, resetMutations } from "../dry-run.js";
import { initFlags } from "../logger.js";

const originalArgv = [...process.argv];

function setFlags(args: string[]): void {
  process.argv = ["node", "knarr", ...args];
  initFlags();
  resetMutations();
}

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = [...originalArgv];
  initFlags();
  resetMutations();
});

describe("json dry-run output", () => {
  it("emits a single JSON document with mutations attached", () => {
    setFlags(["--json", "--dry-run"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    recordMutation({ type: "copy", path: "/src", dest: "/dest" });

    output({ ok: true });
    printDryRunReport();

    expect(log).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({ ok: true, dryRun: true });
    expect(payload.mutations).toHaveLength(1);
  });
});

describe("displayMutationPath", () => {
  it("shows paths inside cwd relative, home paths with ~, others absolute", async () => {
    const { displayMutationPath } = await import("../dry-run.js");
    const { join, resolve } = await import("node:path");
    const cwd = resolve("/work/app");
    const home = resolve("/users/me");
    expect(displayMutationPath(join(cwd, "node_modules", "x"), cwd, home)).toBe(join("node_modules", "x"));
    expect(displayMutationPath(cwd, cwd, home)).toBe(".");
    expect(displayMutationPath(join(home, ".knarr", "store"), cwd, home)).toBe(join("~", ".knarr", "store"));
    expect(displayMutationPath(resolve("/elsewhere/lib"), cwd, home)).toBe(resolve("/elsewhere/lib"));
  });
});
