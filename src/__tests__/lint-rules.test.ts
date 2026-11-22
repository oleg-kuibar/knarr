import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");
const sandbox = mkdtempSync(join(tmpdir(), "knarr-lint-"));
const config = JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8")) as Record<string, unknown>;
writeFileSync(
  join(sandbox, ".oxlintrc.json"),
  JSON.stringify({
    ...config,
    $schema: undefined,
    jsPlugins: [join(root, "lint", "knarr-plugin.mjs")],
    options: { reportUnusedDisableDirectives: "error" },
  })
);

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function lint(path: string, source: string): { status: number | null; output: string } {
  const file = join(sandbox, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const result = spawnSync(process.execPath, [join(root, "node_modules", "oxlint", "bin", "oxlint"), path], {
    cwd: sandbox,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectReported(path: string, source: string, rule: string, ...fixes: string[]): void {
  const { status, output } = lint(path, source);
  expect(status).toBe(1);
  expect(output).toContain(rule);
  for (const fix of fixes) expect(output).toContain(fix);
}

function expectClean(path: string, source: string): void {
  const { status, output } = lint(path, source);
  expect(output).not.toMatch(/error|warning/i);
  expect(status).toBe(0);
}

describe("knarr/no-direct-fs-write", () => {
  it("names the dry-run helper for a named import", () => {
    expectReported(
      "src/core/tracker.ts",
      'import { writeFile } from "node:fs/promises";\nawait writeFile("a", "b");\n',
      "knarr(no-direct-fs-write)",
      "Use atomicWriteFile() from src/utils/fs.ts"
    );
  });

  it("catches writes through a namespace or a promises import", () => {
    expectReported(
      "src/core/store.ts",
      'import * as fs from "node:fs";\nimport { promises as fsp } from "fs";\nfs.rmSync("a");\nawait fsp.mkdir("b");\n',
      "knarr(no-direct-fs-write)",
      "Use removeDir()",
      "Use ensureDir()"
    );
  });

  it("allows reads, and writes inside the helper module", () => {
    expectClean("src/core/reader.ts", 'import { readFile, stat } from "node:fs/promises";\nawait stat(await readFile("a", "utf8"));\n');
    expectClean("src/utils/fs.ts", 'import { writeFile } from "node:fs/promises";\nawait writeFile("a", "b");\n');
  });
});

describe("knarr/no-stdout-write", () => {
  it("points a command at output()", () => {
    expectReported(
      "src/commands/list.ts",
      'process.stdout.write("done");\n',
      "knarr(no-stdout-write)",
      "output() from src/utils/output.ts"
    );
  });

  it("allows output.ts itself and reads of stdout properties", () => {
    expectClean("src/utils/output.ts", 'process.stdout.write("{}");\n');
    expectClean("src/commands/status.ts", "export const tty = process.stdout.isTTY;\n");
  });
});

describe("knarr/require-suppression-reason", () => {
  it("rejects a suppression with no reason", () => {
    expectReported(
      "src/utils/re.ts",
      "// oxlint-disable-next-line no-control-regex\nexport const re = /\\x00/;\n",
      "knarr(require-suppression-reason)",
      "End it with `-- <why"
    );
  });

  it("accepts a suppression that says why", () => {
    expectClean("src/utils/re.ts", "// oxlint-disable-next-line no-control-regex -- matching NUL is the point\nexport const re = /\\x00/;\n");
  });
});

describe("built-in rule messages name the replacement", () => {
  it("child_process import points at the spawn wrappers", () => {
    expectReported(
      "src/core/build.ts",
      'import { spawn } from "node:child_process";\nspawn("x");\n',
      "no-restricted-imports",
      "Use spawnCommand(executable, args) from src/utils/shell.ts"
    );
  });

  it("JSON.parse points at the json helpers", () => {
    expectReported(
      "src/core/meta.ts",
      'export const v: unknown = JSON.parse("{}");\n',
      "no-restricted-properties",
      "Use parseJson(), parseJsonObject() or readJsonObject() from src/utils/json.ts"
    );
  });
});
