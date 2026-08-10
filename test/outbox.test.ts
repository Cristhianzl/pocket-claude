import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bot } from "grammy";
import { Outbox } from "../src/outbox.js";

type Call = { method: "send" | "edit"; text: string; parseMode?: string };

function fakeBot() {
  const calls: Call[] = [];
  let rejectHtml = false;
  let nextMessageId = 1;

  const bot = {
    api: {
      sendMessage: async (_chatId: number, text: string, opts?: { parse_mode?: string }) => {
        if (rejectHtml && opts?.parse_mode === "HTML") {
          throw new Error("Bad Request: can't parse entities");
        }
        calls.push({ method: "send", text, parseMode: opts?.parse_mode });
        return { message_id: nextMessageId++ };
      },
      editMessageText: async (
        _chatId: number,
        _messageId: number,
        text: string,
        opts?: { parse_mode?: string },
      ) => {
        calls.push({ method: "edit", text, parseMode: opts?.parse_mode });
        return true;
      },
    },
  };

  return {
    bot: bot as unknown as Bot,
    calls,
    rejectHtml: (value: boolean) => {
      rejectHtml = value;
    },
  };
}

describe("Outbox", () => {
  it("should_collapse_several_activities_into_one_status_message", async () => {
    const { bot, calls } = fakeBot();
    const outbox = new Outbox(bot, 1);

    outbox.activity("read a.ts");
    outbox.activity("edit a.ts");
    outbox.activity("$ npm test");
    await outbox.drain();

    const sends = calls.filter((call) => call.method === "send");
    assert.equal(sends.length, 1, "activities must not each become a message");
    assert.match(sends[0]!.text, /read a\.ts/);
    assert.match(sends[0]!.text, /npm test/);
  });

  it("should_escape_activity_text_so_tool_output_cannot_inject_markup", async () => {
    const { bot, calls } = fakeBot();
    const outbox = new Outbox(bot, 1);

    outbox.activity("$ echo '<b>x</b> & y'");
    await outbox.drain();

    const text = calls[0]!.text;
    assert.equal(text.includes("<b>x</b>"), false);
    assert.match(text, /&lt;b&gt;x&lt;\/b&gt; &amp; y/);
  });

  it("should_send_prose_after_the_status_it_follows", async () => {
    const { bot, calls } = fakeBot();
    const outbox = new Outbox(bot, 1);

    outbox.activity("read a.ts");
    outbox.markdown("Done reading.");
    await outbox.drain();

    assert.equal(calls.length, 2);
    assert.match(calls[0]!.text, /read a\.ts/);
    assert.match(calls[1]!.text, /Done reading\./);
  });

  // Sealing matters: without it a later activity would edit a status card that
  // now sits above unrelated prose.
  it("should_start_a_new_status_card_after_prose_is_sent", async () => {
    const { bot, calls } = fakeBot();
    const outbox = new Outbox(bot, 1);

    outbox.activity("read a.ts");
    outbox.markdown("Reading done.");
    outbox.activity("edit a.ts");
    await outbox.drain();

    const sends = calls.filter((call) => call.method === "send");
    assert.equal(sends.length, 3);
    assert.equal(
      calls.some((call) => call.method === "edit"),
      false,
    );
  });

  it("should_split_long_prose_across_several_messages", async () => {
    const { bot, calls } = fakeBot();
    const outbox = new Outbox(bot, 1);

    outbox.markdown("word ".repeat(2000));
    await outbox.drain();

    assert.ok(calls.length > 1);
    for (const call of calls) assert.ok(call.text.length <= 4096);
  });

  it("should_retry_as_plain_text_when_telegram_rejects_the_html", async () => {
    const { bot, calls, rejectHtml } = fakeBot();
    rejectHtml(true);
    const outbox = new Outbox(bot, 1);

    outbox.markdown("Compare `a < b` in code.");
    await outbox.drain();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.parseMode, undefined);
    // Regression: the fallback used to leave raw entities visible.
    assert.equal(calls[0]!.text.includes("&lt;"), false);
    assert.match(calls[0]!.text, /a < b/);
  });

  it("should_not_send_anything_for_empty_prose", async () => {
    const { bot, calls } = fakeBot();
    const outbox = new Outbox(bot, 1);

    outbox.markdown("   ");
    await outbox.drain();

    assert.equal(calls.length, 0);
  });

  it("should_survive_a_failing_send_without_breaking_later_output", async () => {
    const { bot, calls, rejectHtml } = fakeBot();
    const outbox = new Outbox(bot, 1);

    rejectHtml(true);
    outbox.notice("<b>first</b>");
    await outbox.drain();
    rejectHtml(false);
    outbox.notice("<b>second</b>");
    await outbox.drain();

    assert.equal(calls.length, 2);
    assert.match(calls[1]!.text, /second/);
  });

  it("should_preserve_ordering_across_interleaved_calls", async () => {
    const { bot, calls } = fakeBot();
    const outbox = new Outbox(bot, 1);

    outbox.markdown("one");
    outbox.notice("<i>two</i>");
    outbox.markdown("three");
    await outbox.drain();

    assert.deepEqual(
      calls.map((call) => call.text.replace(/<[^>]+>/g, "")),
      ["one", "two", "three"],
    );
  });
});
