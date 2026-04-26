/**
 * Minimal p-limit replacement using a promise queue.
 * Drop-in compatible: `const limit = pLimit(N); await limit(fn)`
 *
 * Uses a head pointer for O(1) dequeue instead of Array.shift() which is O(n).
 * Compacts the queue array when it drains to prevent unbounded memory growth.
 */
export default function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  let head = 0;

  const next = () => {
    if (head < queue.length && active < concurrency) {
      active++;
      queue[head++]();
    }
    // Compact when the queue drains to reclaim memory
    if (head > 0 && head === queue.length) {
      queue.length = 0;
      head = 0;
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(
          (val) => { active--; resolve(val); next(); },
          (err) => { active--; reject(err); next(); },
        );
      };

      if (active < concurrency) {
        active++;
        run();
      } else {
        queue.push(run);
      }
    });
}
