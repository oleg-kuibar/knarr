#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = mkdtempSync(join(tmpdir(), "knarr-compat-"));
const pathEnv = process.env.PATH ?? process.env.Path ?? process.env.path ?? "";
const env = {
  ...process.env,
  CI: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  KNARR_HOME: join(tempRoot, ".knarr-home"),
  PATH: pathEnv,
  Path: pathEnv,
};

const results = [];
const failures = [];
const toolVersions = new Map();

function log(message = "") {
  process.stdout.write(`${message}\n`);
}

function run(cwd, command, args, options = {}) {
  const label = [command, ...args].join(" ");
  log(`> ${label}`);

  const resolvedCommand =
    process.platform === "win32" ? resolveWindowsCommand(command) : command;
  const isWindowsBatch =
    process.platform === "win32" && /\.(?:cmd|bat)$/i.test(resolvedCommand);
  const spawnCommand = isWindowsBatch
    ? process.env.ComSpec ?? "cmd.exe"
    : resolvedCommand;
  const spawnArgs = isWindowsBatch
    ? ["/d", "/c", [resolvedCommand, ...args].map(quoteCmdArg).join(" ")]
    : args;

  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    shell: false,
  });

  if (result.error) {
    throw new Error(`Command failed to start: ${label}\n${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const tail = output.split(/\r?\n/).slice(-120).join("\n");
    throw new Error(`Command failed (${result.status}): ${label}\n${tail}`);
  }

  if (options.capture) {
    return result.stdout ?? "";
  }
  return "";
}

function resolveWindowsCommand(command) {
  if (/[\\/]/.test(command)) {
    return command;
  }

  const candidates = [`${command}.exe`, `${command}.cmd`, `${command}.bat`, command];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return command;
}

function quoteCmdArg(arg) {
  const value = String(arg);
  if (/^[\w./:\\@=-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function writeText(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function packageManagerSpec(command) {
  return `${command}@${toolVersion(command)}`;
}

function toolVersion(command) {
  const cached = toolVersions.get(command);
  if (cached) {
    return cached;
  }

  const version = run(repoRoot, command, ["--version"], { capture: true })
    .trim()
    .split(/\s+/)[0];
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
    throw new Error(`${command} --version returned invalid semver: ${version}`);
  }
  toolVersions.set(command, version);
  return version;
}

function fileSpec(fromDir, targetPath) {
  const rel = relative(fromDir, targetPath).replaceAll("\\", "/");
  return `file:${rel.startsWith(".") ? rel : `./${rel}`}`;
}

function makeLib(dir, marker) {
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeJson(join(dir, "package.json"), {
    name: "knarr-compat-lib",
    version: "1.0.0",
    type: "module",
    exports: "./dist/index.js",
    files: ["dist"],
  });
  writeText(
    join(dir, "dist", "index.js"),
    `export const marker = "${marker}";\nexport function readMarker() { return marker; }\n`
  );
}

function binPath(appDir, name, kind = "node") {
  if (process.platform !== "win32") {
    return join(appDir, "node_modules", ".bin", name);
  }
  return join(
    appDir,
    "node_modules",
    ".bin",
    kind === "bun" ? `${name}.exe` : `${name}.cmd`
  );
}

function expectMarker(appDir, expected, label) {
  const actual = run(appDir, process.execPath, [join(appDir, "check.mjs")], {
    capture: true,
  }).trim();
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

function test(name, fn) {
  log(`\n== ${name} ==`);
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (error) {
    failures.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packCurrentPackage() {
  if (!existsSync(join(repoRoot, "dist", "cli.mjs"))) {
    throw new Error("dist/cli.mjs is missing. Run pnpm build before compat:smoke.");
  }

  const packDir = join(tempRoot, "packed");
  mkdirSync(packDir, { recursive: true });
  run(repoRoot, "npm", ["pack", "--pack-destination", packDir]);
  const tarball = readdirSync(packDir).find((file) => file.endsWith(".tgz"));
  if (!tarball) {
    throw new Error("npm pack did not create a tarball.");
  }
  return join(packDir, tarball);
}

function makeConsumer(dir, body) {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "package.json"), body);
  writeText(
    join(dir, "check.mjs"),
    "import { marker } from 'knarr-compat-lib';\nconsole.log(marker);\n"
  );
}

const oldLib = join(tempRoot, "lib-old");
const newLib = join(tempRoot, "lib-new");
makeLib(oldLib, "old-marker");
makeLib(newLib, "new-marker");

const tarball = packCurrentPackage();
log(`Packed ${tarball}`);

test("npm injection", () => {
  const app = join(tempRoot, "npm-app");
  makeConsumer(app, { name: "npm-app", version: "1.0.0", type: "module" });
  run(app, "npm", ["install", fileSpec(app, oldLib), fileSpec(app, tarball)]);
  run(app, binPath(app, "knarr"), ["use", newLib, "--yes"]);
  expectMarker(app, "new-marker", "npm");
});

test("pnpm virtual-store injection", () => {
  const app = join(tempRoot, "pnpm-app");
  makeConsumer(app, {
    name: "pnpm-app",
    version: "1.0.0",
    type: "module",
    packageManager: packageManagerSpec("pnpm"),
  });
  run(app, "pnpm", ["add", fileSpec(app, oldLib)]);
  run(app, "pnpm", ["add", "-D", fileSpec(app, tarball)]);
  run(app, binPath(app, "knarr"), ["use", newLib, "--yes"]);
  expectMarker(app, "new-marker", "pnpm");
});

test("Yarn 4 node-modules injection", () => {
  const app = join(tempRoot, "yarn-app");
  makeConsumer(app, {
    name: "yarn-app",
    version: "1.0.0",
    type: "module",
  });
  writeText(join(app, ".yarnrc.yml"), "nodeLinker: node-modules\n");
  writeText(join(app, "yarn.lock"), "");
  run(app, "yarn", ["add", `knarr-compat-lib@${fileSpec(app, oldLib)}`]);
  run(app, "yarn", ["add", "-D", `knarr@${fileSpec(app, tarball)}`]);
  run(app, binPath(app, "knarr"), ["use", newLib, "--yes"]);
  expectMarker(app, "new-marker", "Yarn");
});

test("Bun injection", () => {
  const app = join(tempRoot, "bun-app");
  makeConsumer(app, {
    name: "bun-app",
    version: "1.0.0",
    type: "module",
    packageManager: packageManagerSpec("bun"),
  });
  run(app, "bun", ["add", fileSpec(app, oldLib)]);
  run(app, "bun", ["add", "-d", fileSpec(app, tarball)]);
  run(app, binPath(app, "knarr", "bun"), ["use", newLib, "--yes"]);
  expectMarker(app, "new-marker", "Bun");
});

test("Vite latest build", () => {
  const app = join(tempRoot, "vite-app");
  mkdirSync(join(app, "src"), { recursive: true });
  writeJson(join(app, "package.json"), {
    name: "vite-app",
    version: "1.0.0",
    type: "module",
    scripts: { build: "vite build" },
    devDependencies: {
      vite: "latest",
      knarr: fileSpec(app, tarball),
    },
  });
  writeText(
    join(app, "index.html"),
    '<div id="app"></div><script type="module" src="/src/main.js"></script>\n'
  );
  writeText(
    join(app, "src", "main.js"),
    "import { marker } from 'knarr-compat-lib';\ndocument.querySelector('#app').textContent = marker;\n"
  );
  writeText(
    join(app, "vite.config.js"),
    "import { defineConfig } from 'vite';\nexport default defineConfig({ plugins: [] });\n"
  );
  run(app, "npm", ["install"]);
  run(app, binPath(app, "knarr"), ["use", newLib, "--yes"]);
  run(app, "npm", ["run", "build"]);
  const assets = readdirSync(join(app, "dist", "assets")).filter((file) => file.endsWith(".js"));
  const bundle = readFileSync(join(app, "dist", "assets", assets[0]), "utf8");
  if (!bundle.includes("new-marker")) {
    throw new Error("Vite bundle did not include injected package marker.");
  }
});

test("Webpack latest build", () => {
  const app = join(tempRoot, "webpack-app");
  mkdirSync(join(app, "src"), { recursive: true });
  writeJson(join(app, "package.json"), {
    name: "webpack-app",
    version: "1.0.0",
    type: "module",
    scripts: { build: "webpack --config webpack.config.cjs" },
    devDependencies: {
      webpack: "latest",
      "webpack-cli": "latest",
      knarr: fileSpec(app, tarball),
    },
  });
  writeText(
    join(app, "src", "index.js"),
    "import { marker } from 'knarr-compat-lib';\nconsole.log(marker);\n"
  );
  writeText(
    join(app, "webpack.config.cjs"),
    "const path = require('node:path');\n" +
      "const { KnarrWebpackPlugin } = require('knarr/webpack');\n" +
      "module.exports = { mode: 'production', target: 'node', entry: './src/index.js', " +
      "output: { path: path.resolve(__dirname, 'dist'), filename: 'bundle.cjs' }, " +
      "plugins: [new KnarrWebpackPlugin()] };\n"
  );
  run(app, "npm", ["install"]);
  run(app, binPath(app, "knarr"), ["use", newLib, "--yes"]);
  run(app, "npm", ["run", "build"]);
  const actual = run(app, process.execPath, [join(app, "dist", "bundle.cjs")], {
    capture: true,
  }).trim();
  if (actual !== "new-marker") {
    throw new Error(`Webpack bundle expected new-marker, got ${actual}`);
  }
});

test("rspack latest build", () => {
  const app = join(tempRoot, "rspack-app");
  mkdirSync(join(app, "src"), { recursive: true });
  writeJson(join(app, "package.json"), {
    name: "rspack-app",
    version: "1.0.0",
    type: "module",
    scripts: { build: "rspack build --config rspack.config.cjs" },
    devDependencies: {
      "@rspack/core": "latest",
      "@rspack/cli": "latest",
      knarr: fileSpec(app, tarball),
    },
  });
  writeText(
    join(app, "src", "index.js"),
    "import { marker } from 'knarr-compat-lib';\nconsole.log(marker);\n"
  );
  writeText(
    join(app, "rspack.config.cjs"),
    "const path = require('node:path');\n" +
      "const { KnarrWebpackPlugin } = require('knarr/webpack');\n" +
      "module.exports = { mode: 'production', target: 'node', entry: './src/index.js', " +
      "output: { path: path.resolve(__dirname, 'dist'), filename: 'bundle.cjs' }, " +
      "plugins: [new KnarrWebpackPlugin()] };\n"
  );
  run(app, "npm", ["install"]);
  run(app, binPath(app, "knarr"), ["use", newLib, "--yes"]);
  run(app, "npm", ["run", "build"]);
  const actual = run(app, process.execPath, [join(app, "dist", "bundle.cjs")], {
    capture: true,
  }).trim();
  if (actual !== "new-marker") {
    throw new Error(`rspack bundle expected new-marker, got ${actual}`);
  }
});

test("Next latest Turbopack build", () => {
  const app = join(tempRoot, "next-app");
  mkdirSync(join(app, "app"), { recursive: true });
  writeJson(join(app, "package.json"), {
    name: "next-app",
    version: "1.0.0",
    type: "module",
    scripts: { build: "next build --turbopack" },
    dependencies: {
      next: "latest",
      react: "latest",
      "react-dom": "latest",
    },
    devDependencies: {
      knarr: fileSpec(app, tarball),
    },
  });
  writeText(join(app, "next.config.mjs"), "export default {};\n");
  writeText(
    join(app, "app", "layout.js"),
    "export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }\n"
  );
  writeText(
    join(app, "app", "page.js"),
    "import { marker } from 'knarr-compat-lib';\nexport default function Page() { return <main>{marker}</main>; }\n"
  );
  run(app, "npm", ["install"]);
  run(app, binPath(app, "knarr"), ["use", newLib, "--yes"]);
  run(app, "npm", ["run", "build"]);
});

log("\n== Compatibility Summary ==");
for (const result of results) log(result);
for (const failure of failures) log(failure);
log(`TEMP_ROOT=${tempRoot}`);

if (failures.length > 0) {
  process.exit(1);
}
