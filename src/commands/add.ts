import { defineCommand } from "citty";
import { Timer } from "../utils/timer.js";
import { suppressHumanOutput } from "../utils/output.js";
import { addPackageToConsumer } from "./add-flow.js";

export default defineCommand({
  meta: {
    name: "add",
    description: "Link a package from the Knarr store into this project",
  },
  args: {
    package: {
      type: "positional",
      description: "Package name to add",
      required: true,
    },
    from: {
      type: "string",
      description: "Path to package source (will publish first)",
    },
    build: {
      type: "string",
      description: "Build command to run before publishing --from",
    },
    "skip-build": {
      type: "boolean",
      description: "Skip build detection before publishing --from",
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
    await addPackageToConsumer({
      packageArg: args.package,
      from: args.from,
      build: args.build,
      skipBuild: args["skip-build"],
      yes: args.yes,
      timer: new Timer(),
    });
  },
});
