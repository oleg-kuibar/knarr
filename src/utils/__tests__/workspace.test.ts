import { describe, expect, it } from "vitest";
import { filterPublishableWorkspaceGraph } from "../workspace.js";
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
