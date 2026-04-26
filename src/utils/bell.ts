/**
 * Ring the terminal bell (BEL character).
 * Writes to stderr so it doesn't interfere with --json output on stdout.
 */
export function ringBell(enabled: boolean): void {
  if (enabled) {
    process.stderr.write("\x07");
  }
}
