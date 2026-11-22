import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exists } from "../utils/fs.js";
import { normalizePath } from "../utils/paths.js";

let knarrHome: string;
let consumer: string;
let registryPath: string;

beforeEach(async () => {
  knarrHome = await mkdtemp(join(tmpdir(), "knarr-tracker-"));
  consumer = await mkdtemp(join(tmpdir(), "knarr-tracker-consumer-"));
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "app", version: "1.0.0" }));
  registryPath = join(knarrHome, "consumers.json");
  process.env.KNARR_HOME = knarrHome;
});

afterEach(async () => {
  delete process.env.KNARR_HOME;
  await rm(knarrHome, { recursive: true, force: true });
  await rm(consumer, { recursive: true, force: true });
});

describe("corrupt consumers registry", () => {
  it("refuses to register over an invalid registry", async () => {
    const { registerConsumer } = await import("../core/tracker.js");
    const corrupt = '{"a":["/x"],"b":5}';
    await writeFile(registryPath, corrupt);

    await expect(registerConsumer("foo", consumer)).rejects.toThrow(/corrupt/);
    expect(await readFile(registryPath, "utf-8")).toBe(corrupt);
  });

  it("treats an array registry as corrupt", async () => {
    const { registerConsumer } = await import("../core/tracker.js");
    await writeFile(registryPath, "[]");

    await expect(registerConsumer("foo", consumer)).rejects.toThrow(/corrupt/);
  });

  it("makes clean delete nothing", async () => {
    const cleanCommand = await import("../commands/clean.js");
    await writeFile(registryPath, '{"a":["/x"],"b":5}');
    const entryDir = join(knarrHome, "store", "foo@1.0.0");
    await mkdir(join(entryDir, "package"), { recursive: true });
    await writeFile(
      join(entryDir, ".knarr-meta.json"),
      JSON.stringify({
        contentHash: "sha256:abc",
        publishedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        sourcePath: "/src/foo",
      })
    );

    await expect(cleanCommand.default.run?.({ args: { yes: true } } as any)).rejects.toThrow(/corrupt/);
    expect(await exists(entryDir)).toBe(true);
    expect(await readFile(registryPath, "utf-8")).toBe('{"a":["/x"],"b":5}');
  });

  it("makes doctor fail the global registry check", async () => {
    const { runDoctorDiagnostics } = await import("../commands/doctor.js");
    await writeFile(registryPath, "[]");

    const result = await runDoctorDiagnostics(consumer);

    const check = result.results.find((r) => r.name === "Global registry");
    expect(check?.status).toBe("fail");
    expect(check?.unfixableReason).toContain("consumers.json");
  });
});

describe("consumers registry keys", () => {
  it("registers a package named like an Object.prototype member", async () => {
    const { registerConsumer, getConsumers } = await import("../core/tracker.js");

    await registerConsumer("constructor", consumer);

    expect(await getConsumers("constructor")).toEqual([normalizePath(consumer)]);
  });
});
