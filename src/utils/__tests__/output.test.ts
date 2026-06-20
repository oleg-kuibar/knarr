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
    const payload = JSON.parse(log.mock.calls[0][0] as string);
    expect(payload).toMatchObject({ ok: true, dryRun: true });
    expect(payload.mutations).toHaveLength(1);
  });
});
