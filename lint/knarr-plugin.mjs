const FS_MODULES = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);

const NO_HELPER = "add a dry-run-aware helper to src/utils/fs.ts that checks isDryRun() and calls recordMutation(), then use it";

const FS_WRITE_FIX = new Map([
  ["writeFile", "atomicWriteFile()"],
  ["appendFile", "atomicWriteFile() with the full new contents"],
  ["truncate", "atomicWriteFile()"],
  ["copyFile", "copyWithCoW()"],
  ["cp", "copyDir() for a directory or copyWithCoW() for a file"],
  ["rm", "removeDir()"],
  ["rmdir", "removeDir()"],
  ["unlink", "removeDir() (it removes files too)"],
  ["rename", "moveDir()"],
  ["mkdir", "ensureDir(), or ensurePrivateDir() for 0o700"],
  ["mkdtemp", "ensureDir() on a path you name"],
  ["symlink", NO_HELPER],
  ["link", NO_HELPER],
  ["chmod", NO_HELPER],
  ["utimes", NO_HELPER],
]);

function fsWriteFix(name) {
  return FS_WRITE_FIX.get(name.endsWith("Sync") ? name.slice(0, -4) : name);
}

function fsWriteMessage(name, source) {
  const fix = fsWriteFix(name);
  const how = fix === NO_HELPER ? `To fix: ${NO_HELPER}.` : `Use ${fix} from src/utils/fs.ts instead.`;
  return `\`${name}\` from "${source}" writes to disk even under --dry-run. ${how}`;
}

const noDirectFsWrite = {
  meta: {
    type: "problem",
    docs: { description: "Route disk writes through the dry-run-aware helpers in src/utils/fs.ts." },
    schema: [],
  },
  create(context) {
    const namespaces = new Map();
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (!FS_MODULES.has(source) || node.importKind === "type") return;
        for (const spec of node.specifiers) {
          if (spec.type === "ImportNamespaceSpecifier" || spec.type === "ImportDefaultSpecifier") {
            namespaces.set(spec.local.name, source);
            continue;
          }
          if (spec.importKind === "type") continue;
          const imported = spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value;
          if (imported === "promises") {
            namespaces.set(spec.local.name, `${source}/promises`);
          } else if (fsWriteFix(imported) !== undefined) {
            context.report({ node: spec, message: fsWriteMessage(imported, source) });
          }
        }
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || node.property.type !== "Identifier" || node.computed) return;
        const source = namespaces.get(node.object.name);
        if (source === undefined) return;
        const name = node.property.name;
        if (name === "promises") return;
        if (fsWriteFix(name) !== undefined) {
          context.report({ node, message: fsWriteMessage(name, source) });
        }
      },
    };
  },
};

const noStdoutWrite = {
  meta: {
    type: "problem",
    docs: { description: "Keep stdout machine-readable in --json mode." },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        const target = node.object;
        if (
          node.property.type === "Identifier" &&
          node.property.name === "write" &&
          target.type === "MemberExpression" &&
          target.object.type === "Identifier" &&
          target.object.name === "process" &&
          target.property.type === "Identifier" &&
          target.property.name === "stdout"
        ) {
          context.report({
            node,
            message:
              "process.stdout.write breaks --json output, where stdout must hold only the JSON result. Return results through output() from src/utils/output.ts and send diagnostics to consola or verbose().",
          });
        }
      },
    };
  },
};

const DIRECTIVE = /^\s*(?:(?:oxlint|eslint)-disable(?:-next-line|-line)?\b|@ts-(?:expect-error|ignore|nocheck)\b)/;
const REASON = /\s--\s*\S/;

const requireSuppressionReason = {
  meta: {
    type: "problem",
    docs: { description: "Every lint or type-checker suppression says why." },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (!DIRECTIVE.test(comment.value) || REASON.test(comment.value)) continue;
          context.report({
            loc: comment.loc,
            message:
              "Suppression without a reason. End it with `-- <why this line is the exception>`, or fix the code instead: a suppression of a rule that guards correctness is not allowed (AGENTS.md, Secure coding).",
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "knarr" },
  rules: {
    "no-direct-fs-write": noDirectFsWrite,
    "no-stdout-write": noStdoutWrite,
    "require-suppression-reason": requireSuppressionReason,
  },
};
