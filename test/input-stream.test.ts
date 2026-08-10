import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InputStream } from "../src/input-stream.js";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

function textOf(message: { message: { content: unknown } }): unknown {
  return message.message.content;
}

describe("InputStream", () => {
  it("should_yield_messages_pushed_before_iteration_starts", async () => {
    const stream = new InputStream();
    stream.push("first");
    stream.push("second");
    stream.close();

    const seen: unknown[] = [];
    for await (const message of stream.stream()) seen.push(textOf(message));

    assert.deepEqual(seen, ["first", "second"]);
  });

  // Regression guard for the wake-up race: a push landing while the consumer is
  // parked must resume it rather than be buffered until the next push.
  it("should_deliver_a_message_pushed_while_the_consumer_is_waiting", async () => {
    const stream = new InputStream();
    const seen: unknown[] = [];

    const consumer = (async () => {
      for await (const message of stream.stream()) {
        seen.push(textOf(message));
        if (seen.length === 2) stream.close();
      }
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    stream.push("late-one");
    await new Promise((resolve) => setTimeout(resolve, 10));
    stream.push("late-two");

    await consumer;
    assert.deepEqual(seen, ["late-one", "late-two"]);
  });

  it("should_stamp_messages_as_human_originated", async () => {
    const stream = new InputStream();
    stream.push("hello");
    stream.close();

    const [message] = await collect(stream.stream());
    assert.deepEqual(message?.origin, { kind: "human" });
    assert.equal(message?.type, "user");
    assert.equal(message?.parent_tool_use_id, null);
  });

  it("should_terminate_iteration_when_closed_while_empty", async () => {
    const stream = new InputStream();
    stream.close();
    assert.deepEqual(await collect(stream.stream()), []);
  });

  it("should_ignore_pushes_after_close", async () => {
    const stream = new InputStream();
    stream.close();
    stream.push("dropped");
    assert.equal(stream.pending, 0);
    assert.equal(stream.closed, true);
  });

  it("should_drain_buffered_messages_before_terminating_on_close", async () => {
    const stream = new InputStream();
    stream.push("a");
    stream.push("b");
    stream.close();
    const seen = await collect(stream.stream());
    assert.equal(seen.length, 2);
  });
});
