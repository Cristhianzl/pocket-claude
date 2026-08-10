/**
 * Serializes async tasks per key. Without it, two Telegram messages arriving
 * back-to-back both miss the session cache and each spawn an agent, leaking a
 * CLI process.
 */
export class KeyedMutex<K> {
  #tails = new Map<K, Promise<unknown>>();

  run<T>(key: K, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    // `then(task, task)` so a rejected predecessor still releases the lock.
    const next = previous.then(task, task);
    const settled = next.then(
      () => {},
      () => {},
    );
    this.#tails.set(key, settled);
    void settled.then(() => {
      if (this.#tails.get(key) === settled) this.#tails.delete(key);
    });
    return next;
  }

  get size(): number {
    return this.#tails.size;
  }
}
