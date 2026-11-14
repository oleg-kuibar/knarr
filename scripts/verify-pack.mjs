#!/usr/bin/env node
/**
 * Fail if the npm tarball would contain anything outside the allowlist, or
 * grows suspiciously. Run after `pnpm build`; CI and the publish job run it so
 * a stray .env, source map, fixture, or test file can never be published.
 *
 *   node scripts/verify-pack.mjs
 */
import { execSync } from "node:child_process";

const ALLOWED = [
  /^package\.json$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^dist\/[\w.-]+\.mjs$/,
  /^dist\/[\w.-]+\.d\.ts$/,
];
// Generous headroom over today's ~0.5 MB unpacked; a jump past this needs a look.
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024;
const REQUIRED = ["package.json", "dist/cli.mjs", "dist/index.mjs", "dist/index.d.ts"];

// Fixed command string (no user input) through the shell: npm is a .cmd shim on
// Windows, and passing an args array with shell: true is deprecated (DEP0190).
const raw = execSync("npm pack --dry-run --json --ignore-scripts", {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const [pack] = JSON.parse(raw);
const files = pack.files.map((f) => f.path.replaceAll("\\", "/"));

const problems = [];
for (const file of files) {
  if (!ALLOWED.some((re) => re.test(file))) problems.push(`not allowlisted: ${file}`);
}
for (const file of REQUIRED) {
  if (!files.includes(file)) problems.push(`missing: ${file} (did you run pnpm build?)`);
}
if (pack.unpackedSize > MAX_UNPACKED_BYTES) {
  problems.push(`unpacked size ${pack.unpackedSize} B exceeds ${MAX_UNPACKED_BYTES} B`);
}

if (problems.length > 0) {
  console.error(`verify-pack: ${problems.length} problem(s) in ${pack.filename}`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`verify-pack: ${files.length} files, ${pack.unpackedSize} B unpacked, all allowlisted`);
