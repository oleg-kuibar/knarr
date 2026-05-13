import { defineCommand } from "citty";
import { resolve } from "node:path";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput } from "../utils/output.js";
import { addPackageToConsumer, readPackageNameFromSource } from "./add-flow.js";

export default defineCommand({
  meta: {
    name: "use",
    description: "Publish a local package path and link it into this project",
  },
  args: {
    path: {
      type: "positional",
      description: "Path to the local package source",
      required: true,
    },
    build: {
      type: "string",
      description: "Build command to run before publishing",
    },
    "skip-build": {
      type: "boolean",
      description: "Skip build detection before publishing",
      default: false,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Auto-accept prompts (install missing deps, etc.)",
      default: false,
    },
  },
  async run({ args }) {
    suppressHumanOutput();
    const timer = new Timer();
    const from = resolve(args.path);
    const packageName = await readPackageNameFromSource(from);

    await addPackageToConsumer({
      packageArg: packageName,
      from,
      build: args.build,
      skipBuild: args["skip-build"],
      yes: args.yes,
      timer,
    });
  },
});
