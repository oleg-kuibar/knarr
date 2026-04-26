import { defineCommand } from "citty";
import { resolve } from "node:path";
import { consola } from "../utils/console.js";
import pc from "picocolors";
import { runPreflightChecks } from "../utils/preflight.js";
import { suppressHumanOutput, output } from "../utils/output.js";

export default defineCommand({
  meta: {
    name: "check",
    description:
      "Validate package configuration (exports, types, entry points)",
  },
  args: {
    dir: {
      type: "positional",
      description: "Package directory (default: current directory)",
      required: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const dir = resolve(args.dir || ".");

    const issues = await runPreflightChecks(dir);

    if (issues.length === 0) {
      consola.success("All pre-flight checks passed");
      output({ issues: [], passed: true });
      return;
    }

    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warn");

    consola.info(`Found ${issues.length} issue(s):\n`);

    for (const issue of errors) {
      consola.log(`  ${pc.red("ERROR")} ${pc.dim(`[${issue.code}]`)} ${issue.message}`);
    }
    for (const issue of warnings) {
      consola.log(`  ${pc.yellow("WARN")}  ${pc.dim(`[${issue.code}]`)} ${issue.message}`);
    }

    if (errors.length > 0) {
      consola.error(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
    } else {
      consola.warn(`\n${warnings.length} warning(s)`);
    }

    output({ issues, passed: errors.length === 0 });
  },
});
