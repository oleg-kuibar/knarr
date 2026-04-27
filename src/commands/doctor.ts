import { defineCommand } from "citty";
import { resolve, join } from "node:path";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import { readConsumerStateSafe, readConsumersRegistry } from "../core/tracker.js";
import { listStoreEntries, getStoreEntry } from "../core/store.js";
import { exists } from "../utils/fs.js";
import { getStorePath, getConsumersPath } from "../utils/paths.js";
import { detectPackageManager, detectYarnNodeLinker, hasYarnrcYml } from "../utils/pm-detect.js";
import { detectBundler } from "../utils/bundler-detect.js";
import { suppressHumanOutput, output } from "../utils/output.js";

interface CheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Run diagnostic checks on your Knarr setup",
  },
  async run() {
    suppressHumanOutput();
    const consumerPath = resolve(".");
    const results: CheckResult[] = [];

    consola.info("Running Knarr diagnostics...\n");

    // Check 1: Store directory exists
    const storePath = getStorePath();
    if (await exists(storePath)) {
      const entries = await listStoreEntries();
      results.push({
        name: "Store directory",
        status: "pass",
        message: `${entries.length} entries in ${storePath}`,
      });
    } else {
      results.push({
        name: "Store directory",
        status: "warn",
        message: `Store not found at ${storePath}. Run 'knarr publish' to create it.`,
      });
    }

    // Check 2: Global registry
    const consumersPath = getConsumersPath();
    if (await exists(consumersPath)) {
      const registry = await readConsumersRegistry();
      const total = Object.values(registry).flat().length;
      results.push({
        name: "Global registry",
        status: "pass",
        message: `${Object.keys(registry).length} packages, ${total} consumer registrations`,
      });
    } else {
      results.push({
        name: "Global registry",
        status: "warn",
        message: "No consumers registered yet. Use 'knarr add' to link packages.",
      });
    }

    // Check 3: Consumer state
    const { state, reliable } = await readConsumerStateSafe(consumerPath);
    if (!reliable) {
      results.push({
        name: "Consumer state",
        status: "fail",
        message: "state.json is corrupt or unreadable. Delete .knarr/state.json and re-run 'knarr add' for each package.",
      });
    }
    const links = Object.entries(state.links);
    if (links.length > 0) {
      results.push({
        name: "Consumer state",
        status: "pass",
        message: `${links.length} linked package(s)`,
      });

      // Check 4: Store entries for linked packages
      for (const [name, link] of links) {
        const entry = await getStoreEntry(name, link.version);
        if (!entry) {
          results.push({
            name: `Store: ${name}`,
            status: "fail",
            message: `Store entry missing for ${name}@${link.version}. Re-publish it.`,
          });
        } else if (entry.meta.contentHash !== link.contentHash) {
          results.push({
            name: `Store: ${name}`,
            status: "warn",
            message: `Store has newer content. Run 'knarr update' to sync.`,
          });
        } else {
          results.push({
            name: `Store: ${name}`,
            status: "pass",
            message: `${name}@${link.version} in sync`,
          });
        }

        // Check 5: node_modules presence and version
        const nmPath = join(consumerPath, "node_modules", name);
        if (!(await exists(nmPath))) {
          results.push({
            name: `node_modules: ${name}`,
            status: "fail",
            message: `Missing from node_modules. Run 'knarr restore'.`,
          });
        } else {
          // Verify the installed version matches what KNARR injected
          try {
            const { readFile: rf } = await import("node:fs/promises");
            const nmPkg = JSON.parse(await rf(join(nmPath, "package.json"), "utf-8"));
            if (nmPkg.version && nmPkg.version !== link.version) {
              results.push({
                name: `node_modules: ${name}`,
                status: "warn",
                message: `node_modules has v${nmPkg.version} but Knarr linked v${link.version}. Run 'knarr restore'.`,
              });
            }
          } catch {
            // Can't read package.json — skip version check
          }
        }
      }
    } else {
      results.push({
        name: "Consumer state",
        status: "warn",
        message: "No packages linked. Use 'knarr add' to link a package.",
      });
    }

    // Check 6: Package manager
    const pm = await detectPackageManager(consumerPath);
    results.push({
      name: "Package manager",
      status: "pass",
      message: pm,
    });

    // Check 7: Yarn nodeLinker
    if (pm === "yarn") {
      const linker = await detectYarnNodeLinker(consumerPath);
      const yarnrcExists = await hasYarnrcYml(consumerPath);

      if (!yarnrcExists) {
        results.push({
          name: "Yarn linker",
          status: "pass",
          message: "Yarn Classic, node_modules mode",
        });
      } else if (linker === "node-modules") {
        results.push({
          name: "Yarn linker",
          status: "pass",
          message: "Yarn Berry with node-modules linker",
        });
      } else if (linker === "pnpm") {
        results.push({
          name: "Yarn linker",
          status: "pass",
          message: "Yarn pnpm linker mode (Knarr handles this)",
        });
      } else if (linker === "pnp") {
        results.push({
          name: "Yarn linker",
          status: "fail",
          message: "Yarn PnP is not compatible. Set `nodeLinker: node-modules` in .yarnrc.yml",
        });
      } else {
        // .yarnrc.yml exists but no nodeLinker key — Berry defaults to PnP
        results.push({
          name: "Yarn linker",
          status: "warn",
          message: "Yarn Berry defaults to PnP. Add `nodeLinker: node-modules` to .yarnrc.yml",
        });
      }
    }

    // Check 8: Bundler detection
    const bundler = await detectBundler(consumerPath);
    if (bundler.type) {
      results.push({
        name: "Bundler",
        status: "pass",
        message: `${bundler.type}${bundler.configFile ? ` (${bundler.configFile})` : ""}`,
      });
    } else {
      results.push({
        name: "Bundler",
        status: "warn",
        message: "No bundler config detected",
      });
    }

    // Check 9: .gitignore includes .knarr/
    const gitignorePath = join(consumerPath, ".gitignore");
    if (await exists(gitignorePath)) {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(gitignorePath, "utf-8");
      if (content.includes(".knarr")) {
        results.push({
          name: ".gitignore",
          status: "pass",
          message: ".knarr/ is ignored",
        });
      } else {
        results.push({
          name: ".gitignore",
          status: "warn",
          message: ".knarr/ not in .gitignore. Run 'knarr init' to fix.",
        });
      }
    }

    // Check 10: Node.js version
    const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
    if (nodeMajor >= 22) {
      results.push({
        name: "Node.js version",
        status: "pass",
        message: `v${process.versions.node}`,
      });
    } else {
      results.push({
        name: "Node.js version",
        status: "fail",
        message: `v${process.versions.node}; Knarr requires Node.js >= 22`,
      });
    }

    // Render results
    const icons = {
      pass: pc.green("PASS"),
      fail: pc.red("FAIL"),
      warn: pc.yellow("WARN"),
    };

    for (const r of results) {
      consola.log(`  ${icons[r.status]} ${r.name}: ${pc.dim(r.message)}`);
    }

    const failCount = results.filter((r) => r.status === "fail").length;
    const warnCount = results.filter((r) => r.status === "warn").length;
    consola.log("");
    if (failCount > 0) {
      consola.error(`${failCount} issue(s) found that need attention`);
    } else if (warnCount > 0) {
      consola.warn(`${warnCount} warning(s), but no critical issues`);
    } else {
      consola.success("All checks passed!");
    }

    output({
      results: results.map(({ name, status, message }) => ({ name, status, message })),
      failures: failCount,
      warnings: warnCount,
    });
  },
});
