import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KeyedMutex } from "../src/mutex.js";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("KeyedMutex", () => {
  // Regression guard: concurrent cache-miss callers must not each create a
  // session (each one spawns a CLI process).
  it("should_run_tasks_for_the_same_key_one_at_a_time", async () => {
    const mutex = new KeyedMutex<string>();
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        mutex.run("chat", async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await tick(5);
          active -= 1;
        }),
      ),
    );

    assert.equal(maxActive, 1);
  });

  it("should_let_the_first_task_populate_a_cache_the_rest_reuse", async () => {
    const mutex = new KeyedMutex<number>();
    const cache = new Map<number, symbol>();
    let creations = 0;

    const get = () =>
      mutex.run(42, async () => {
        const hit = cache.get(42);
        if (hit) return hit;
        await tick(5);
        creations += 1;
        const created = Symbol("entry");
        cache.set(42, created);
        return created;
      });

    const results = await Promise.all([get(), get(), get(), get()]);

    assert.equal(creations, 1);
    assert.equal(new Set(results).size, 1);
  });

  it("should_run_different_keys_concurrently", async () => {
    const mutex = new KeyedMutex<string>();
    const order: string[] = [];

    await Promise.all([
      mutex.run("a", async () => {
        await tick(20);
        order.push("a");
      }),
      mutex.run("b", async () => {
        await tick(1);
        order.push("b");
      }),
    ]);

    assert.deepEqual(order, ["b", "a"]);
  });

  it("should_release_the_lock_when_a_task_rejects", async () => {
    const mutex = new KeyedMutex<string>();
    await assert.rejects(
      mutex.run("chat", async () => {
        throw new Error("boom");
      }),
      /boom/,
    );

    assert.equal(await mutex.run("chat", async () => "recovered"), "recovered");
  });

  it("should_not_leak_entries_after_tasks_settle", async () => {
    const mutex = new KeyedMutex<string>();
    await mutex.run("a", async () => undefined);
    await mutex.run("b", async () => undefined);
    await tick(5);
    assert.equal(mutex.size, 0);
  });
});
