import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { filterPublishableWorkspaceGraph, parseCatalogs } from "../workspace.js";
import type { WorkspaceGraph } from "../workspace.js";

describe("filterPublishableWorkspaceGraph", () => {
  it("removes private packages and edges to them", () => {
    const graph: WorkspaceGraph = {
      packages: [
        {
          name: "public-lib",
          version: "1.0.0",
          dir: "/repo/packages/public-lib",
          pkg: { name: "public-lib", version: "1.0.0" },
        },
        {
          name: "private-app",
          version: "1.0.0",
          dir: "/repo/apps/private-app",
          pkg: { name: "private-app", version: "1.0.0", private: true },
        },
      ],
      adjacency: new Map([
        ["public-lib", new Set(["private-app"])],
        ["private-app", new Set(["public-lib"])],
      ]),
    };

    const filtered = filterPublishableWorkspaceGraph(graph);

    expect(filtered.packages.map((pkg) => pkg.name)).toEqual(["public-lib"]);
    expect([...filtered.adjacency.get("public-lib")!]).toEqual([]);
  });
});

describe("parseCatalogs", () => {
  it("strips inline comments from catalog versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "KNARR-workspace-"));
    try {
      await writeFile(
        join(root, "pnpm-workspace.yaml"),
        [
          "packages:",
          "  - packages/*",
          "catalog:",
          "  react: ^19.0.0 # default catalog comment",
          '  "@scope/pkg": ^1.0.0',
          "  hashy: \"npm:pkg#tag\" # keep quoted hash",
          "catalogs:",
          "  legacy:",
          "    react: ^18.0.0 # named catalog comment",
          '    "@scope/pkg": ^0.9.0',
          "",
        ].join("\n")
      );

      const catalogs = await parseCatalogs(root);

      expect(catalogs.default.react).toBe("^19.0.0");
      expect(catalogs.default["@scope/pkg"]).toBe("^1.0.0");
      expect(catalogs.default.hashy).toBe("npm:pkg#tag");
      expect(catalogs.named.legacy.react).toBe("^18.0.0");
      expect(catalogs.named.legacy["@scope/pkg"]).toBe("^0.9.0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
