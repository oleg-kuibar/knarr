import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSummary } from "../core/push-engine.js";

const pushMocks = vi.hoisted(() => ({
  doPush: vi.fn(),
}));

vi.mock("../core/push-engine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core/push-engine.js")>();
  return {
    ...actual,
    doPush: pushMocks.doPush,
  };
});

import { WatchOrchestrator } from "../core/watch-orchestrator.js";

type TestPackageEntry = {
  dir: string;
  buildCmd?: string;
  state: "idle" | "building" | "queued";
  watcher: { close: () => Promise<void> };
};

type TestWatchOrchestrator = WatchOrchestrator & {
  packages: Map<string, TestPackageEntry>;
  dependents: Map<string, Set<string>>;
  requestRebuild(name: string): Promise<void>;
};

beforeEach(() => {
  pushMocks.doPush.mockReset();
});

describe("WatchOrchestrator", () => {
  it("does not cascade rebuilds after partial push failures", async () => {
    pushMocks.doPush.mockResolvedValue(pushSummary({ failedConsumers: 1 }));

    const orchestrator = new WatchOrchestrator(true) as TestWatchOrchestrator;
    orchestrator.packages.set("dep-a", packageEntry("/tmp/dep-a"));
    orchestrator.packages.set("dep-b", packageEntry("/tmp/dep-b"));
    orchestrator.dependents.set("dep-a", new Set(["dep-b"]));
    orchestrator.dependents.set("dep-b", new Set());

    await orchestrator.requestRebuild("dep-a");

    expect(pushMocks.doPush).toHaveBeenCalledTimes(1);
    expect(pushMocks.doPush).toHaveBeenCalledWith("/tmp/dep-a", {});
  });
});

function packageEntry(dir: string): TestPackageEntry {
  return {
    dir,
    state: "idle",
    watcher: { close: async () => {} },
  };
}

function pushSummary(
  overrides: Partial<PushSummary> = {}
): PushSummary {
  return {
    name: "dep-a",
    version: "1.0.0",
    buildId: "build",
    noChange: false,
    consumers: 1,
    updatedConsumers: 0,
    failedConsumers: 0,
    skippedConsumers: 0,
    copied: 0,
    removed: 0,
    skipped: 0,
    binLinks: 0,
    cacheInvalidations: 0,
    elapsed: 0,
    consumerResults: [],
    ...overrides,
  };
}
