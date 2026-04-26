import pc from "picocolors";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/** Logging level: -1=silent, 0=fatal, 1=error, 2=warn, 3=info, 4=debug */
let _level = 3;

interface ConfirmOptions {
  type: "confirm";
  initial?: boolean;
}

interface SelectOption {
  label: string;
  value: string;
}

interface SelectOptions {
  type: "select";
  options: SelectOption[];
}

interface TextOptions {
  type: "text";
  default?: string;
}

type PromptOptions = ConfirmOptions | SelectOptions | TextOptions;

async function prompt(message: string, options: ConfirmOptions): Promise<boolean>;
async function prompt(message: string, options: SelectOptions): Promise<string>;
async function prompt(message: string, options: TextOptions): Promise<string>;
async function prompt(
  message: string,
  options: PromptOptions,
): Promise<boolean | string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (options.type === "confirm") {
      const hint = options.initial !== false ? "Y/n" : "y/N";
      const answer = await rl.question(
        `${pc.cyan("?")} ${message} ${pc.dim(`(${hint})`)} `,
      );
      const val = answer.trim().toLowerCase();
      if (val === "") return options.initial !== false;
      return val === "y" || val === "yes";
    }

    if (options.type === "text") {
      const hint = options.default ? pc.dim(` (${options.default})`) : "";
      const answer = await rl.question(`${pc.cyan("?")} ${message}${hint} `);
      return answer.trim() || options.default || "";
    }

    // select
    console.log(`${pc.cyan("?")} ${message}`);
    for (let i = 0; i < options.options.length; i++) {
      console.log(`  ${pc.cyan(`${i + 1}.`)} ${options.options[i].label}`);
    }
    const answer = await rl.question(`${pc.dim("Enter number:")} `);
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < options.options.length) {
      return options.options[idx].value;
    }
    return options.options[0].value;
  } finally {
    rl.close();
  }
}

export const consola = {
  get level() {
    return _level;
  },
  set level(n: number) {
    _level = n;
  },

  info(msg: string, ...args: unknown[]) {
    if (_level >= 3) console.log(pc.cyan("ℹ"), msg, ...args);
  },
  success(msg: string, ...args: unknown[]) {
    if (_level >= 3) console.log(pc.green("✔"), msg, ...args);
  },
  warn(msg: string, ...args: unknown[]) {
    if (_level >= 2) console.warn(pc.yellow("⚠"), msg, ...args);
  },
  error(msg: string, ...args: unknown[]) {
    if (_level >= 1) console.error(pc.red("✖"), msg, ...args);
  },
  start(msg: string, ...args: unknown[]) {
    if (_level >= 3) console.log(pc.cyan("◐"), msg, ...args);
  },
  debug(msg: string, ...args: unknown[]) {
    if (_level >= 4) console.debug(pc.dim("D"), msg, ...args);
  },
  /** Plain log (no icon) that still respects level suppression */
  log(msg: string, ...args: unknown[]) {
    if (_level >= 3) console.log(msg, ...args);
  },

  prompt,
};
