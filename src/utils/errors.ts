import { consola } from "./console.js";
import pc from "picocolors";

interface Suggestion {
  pattern: RegExp;
  message: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    pattern: /not found in store/i,
    message: "Run 'knarr publish' in the package directory first, or use --from <path>.",
  },
  {
    pattern: /is not linked/i,
    message: "Run 'knarr add <package>' to link it first.",
  },
  {
    pattern: /No package\.json/i,
    message: "Make sure you're in a valid package directory with a package.json.",
  },
  {
    pattern: /missing 'name'/i,
    message: "Add a 'name' field to your package.json.",
  },
  {
    pattern: /missing 'version'/i,
    message: "Add a 'version' field to your package.json.",
  },
  {
    pattern: /store entry missing/i,
    message: "Re-publish the package with 'knarr publish'.",
  },
  {
    pattern: /EACCES|EPERM/i,
    message: "Permission denied. Try running with elevated privileges or check file ownership.",
  },
  {
    pattern: /ENOSPC/i,
    message: "Disk is full. Free up some space and try again.",
  },
  {
    pattern: /No publishable files/i,
    message: "Check the 'files' field in package.json, or ensure the build output exists.",
  },
  {
    pattern: /private.*package/i,
    message: "Use --private flag to publish private packages.",
  },
  {
    pattern: /Failed to read store entry/i,
    message: "The store may be corrupted. Try 'knarr clean' then re-publish.",
  },
  {
    pattern: /Failed to acquire lock/i,
    message: "Another Knarr process may be running. Wait or delete stale .lk directories.",
  },
  {
    pattern: /not a directory/i,
    message: "Check that the path exists and is a directory.",
  },
  {
    pattern: /timed out/i,
    message: "Set KNARR_HOOK_TIMEOUT to a higher value (in ms) if your scripts need more time.",
  },
  {
    pattern: /state.*corrupt|corrupt.*state/i,
    message: "Delete .knarr/state.json and re-run 'knarr add' for each package.",
  },
  {
    pattern: /EBUSY/i,
    message: "A file is locked by another process (e.g. dev server). Stop the process and retry.",
  },
  {
    pattern: /Invalid package name/i,
    message: "Package names must be non-empty. Use format: package-name or @scope/package-name.",
  },
];

/**
 * Log an error with an actionable suggestion if one matches.
 */
export function errorWithSuggestion(message: string): void {
  consola.error(message);
  for (const { pattern, message: suggestion } of SUGGESTIONS) {
    if (pattern.test(message)) {
      consola.info(`${pc.dim("Suggestion:")} ${suggestion}`);
      break;
    }
  }
}
