/**
 * Simple timer for measuring command execution time.
 */
export class Timer {
  private start = performance.now();

  /** Return elapsed time in ms */
  elapsedMs(): number {
    return performance.now() - this.start;
  }

  /** Return human-readable elapsed time (e.g., "1.2s" or "150ms") */
  elapsed(): string {
    const ms = this.elapsedMs();
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${Math.round(ms)}ms`;
  }
}
