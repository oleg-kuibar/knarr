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
      expect(catalogs.named.legacy?.react).toBe("^18.0.0");
      expect(catalogs.named.legacy?.["@scope/pkg"]).toBe("^0.9.0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("parseCatalogs prototype safety", () => {
  it("stores __proto__/constructor catalog names and keys as plain data", async () => {
    const root = await mkdtemp(join(tmpdir(), "KNARR-workspace-proto-"));
    try {
      await writeFile(
        join(root, "pnpm-workspace.yaml"),
        [
          "catalog:",
          "  __proto__: ^6.6.6",
          "  constructor: ^1.0.0",
          "catalogs:",
          "  __proto__:",
          "    polluted: yes",
          "",
        ].join("\n")
      );

      const catalogs = await parseCatalogs(root);

      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty("polluted");
      // Keys are stored as plain data and looked up without the prototype chain.
      expect(Object.getOwnPropertyDescriptor(catalogs.default, "__proto__")?.value).toBe("^6.6.6");
      expect(catalogs.default["constructor"]).toBe("^1.0.0");
      expect(catalogs.default["toString"]).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("parseCatalogs named-catalog prototype safety", () => {
  it("does not let a __proto__ catalog make unknown catalog names resolve", async () => {
    const root = await mkdtemp(join(tmpdir(), "KNARR-workspace-proto2-"));
    try {
      await writeFile(
        join(root, "pnpm-workspace.yaml"),
        ["catalogs:", "  __proto__:", "    react: ^0.0.1", ""].join("\n")
      );

      const catalogs = await parseCatalogs(root);

      // With a plain {} map, the "__proto__" catalog became the map's prototype,
      // so the non-existent catalog "react" resolved to "^0.0.1".
      expect(catalogs.named["react"]).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(catalogs.named, "__proto__")?.value).toEqual({ react: "^0.0.1" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
