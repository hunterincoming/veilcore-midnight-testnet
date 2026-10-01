// SPDX-License-Identifier: Apache-2.0
/**
 * The local private-state store (LevelDB) opens the database for each operation and
 * holds a lock while it does, so two operations at the same moment fail with "Database
 * failed to open". This wraps the store so its operations run one after another, in the
 * order they were called. setContractAddress is queued too, so it never changes which
 * contract an earlier, still-waiting operation applies to.
 */
export const oneAtATime = <T extends object>(store: T): T => {
  let queue: Promise<unknown> = Promise.resolve();
  return new Proxy(store, {
    get(target, name, receiver) {
      const value = Reflect.get(target, name, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const run = queue.then(() => value.apply(target, args));
        queue = run.catch(() => undefined); // a failed operation does not block the next
        return run;
      };
    },
  });
};
