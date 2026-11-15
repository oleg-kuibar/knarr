import { pc } from "./colors.js";
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
  /** Shown when stdin is not a TTY, e.g. "Pass --role consumer or --role library." */
  nonInteractiveHint?: string;
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
  if (!stdin.isTTY) return answerNonInteractive(message, options);

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
    for (const [i, option] of options.options.entries()) {
      console.log(`  ${pc.cyan(`${i + 1}.`)} ${option.label}`);
    }
    const answer = await rl.question(`${pc.dim("Enter number:")} `);
    const chosen = options.options[parseInt(answer, 10) - 1] ?? options.options[0];
    if (!chosen) throw new Error(`No options to choose from for "${message}"`);
    return chosen.value;
  } finally {
    rl.close();
  }
}

/**
 * Without a TTY, readline never resolves: Node drains the event loop and exits
 * 0 mid-command, so a script or CI job "succeeds" having done nothing. Answer
 * from the prompt's declared default instead, and fail loudly when there is no
 * safe default (destructive confirms declare none; selects need a choice).
 */
function answerNonInteractive(message: string, options: PromptOptions): boolean | string {
  if (options.type === "confirm" && options.initial !== undefined) {
    console.error(
      `${pc.cyan("i")} ${message} ${pc.dim(`-> ${options.initial ? "yes" : "no"} (no interactive terminal, using default)`)}`,
    );
    return options.initial;
  }
  if (options.type === "text") {
    return options.default ?? "";
  }
  console.error(`${pc.red("x")} Cannot ask "${message}": no interactive terminal (stdin is not a TTY).`);
  console.error(
    `${pc.cyan("i")} ${pc.dim("Suggestion:")} ${
      options.type === "confirm"
        ? "Re-run with --yes to confirm."
        : options.nonInteractiveHint ?? "Pass the choice as a flag (see --help)."
    }`,
  );
  process.exit(1);
}

export const consola = {
  get level(): number {
    return _level;
  },
  set level(n: number) {
    _level = n;
  },

  info(msg: string, ...args: unknown[]): void {
    if (_level >= 3) console.log(pc.cyan("i"), msg, ...args);
  },
  success(msg: string, ...args: unknown[]): void {
    if (_level >= 3) console.log(pc.green("OK"), msg, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    if (_level >= 2) console.warn(pc.yellow("!"), msg, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    if (_level >= 1) console.error(pc.red("x"), msg, ...args);
  },
  start(msg: string, ...args: unknown[]): void {
    if (_level >= 3) console.log(pc.cyan("..."), msg, ...args);
  },
  debug(msg: string, ...args: unknown[]): void {
    if (_level >= 4) console.debug(pc.dim("D"), msg, ...args);
  },
  /** Plain log (no icon) that still respects level suppression */
  log(msg: string, ...args: unknown[]): void {
    if (_level >= 3) console.log(msg, ...args);
  },

  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- isolatedDeclarations (tsconfig.dts.json) needs the explicit type
  prompt: prompt as typeof prompt,
};
