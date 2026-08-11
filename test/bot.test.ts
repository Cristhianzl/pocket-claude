import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { registerHandlers } from "../src/bot.js";
import { SessionManager } from "../src/sessions.js";
import { StateStore } from "../src/store.js";
import { fakeAgentFactory, fakeBot, testConfig } from "./helpers/fakes.js";
import { type FakeContext, fakeContext, recordingBot } from "./helpers/recording-bot.js";

async function harness() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-claude-bot-"));
  const config = testConfig({ ALLOWED_USERS: "111,222" });
  const agents = fakeAgentFactory();
  const sessions = new SessionManager(
    fakeBot().bot,
    config,
    new StateStore(path.join(dir, "state.json")),
    agents.factory,
  );
  const recorder = recordingBot();
  registerHandlers(recorder.bot, config, sessions);
  return { recorder, sessions, agents };
}

async function runAccessGate(
  recorder: Awaited<ReturnType<typeof harness>>["recorder"],
  ctx: FakeContext,
) {
  const gate = recorder.middlewares[0];
  assert.ok(gate, "an access gate must be registered");
  let passed = false;
  await gate(ctx, async () => {
    passed = true;
  });
  return passed;
}

describe("access gate", () => {
  it("should_let_an_allowlisted_user_through_in_a_private_chat", async () => {
    const { recorder } = await harness();
    const { ctx, replies } = fakeContext({ userId: 111, chatType: "private" });

    assert.equal(await runAccessGate(recorder, ctx), true);
    assert.deepEqual(replies, []);
  });

  it("should_reject_a_user_who_is_not_allowlisted", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ userId: 999, chatType: "private" });

    assert.equal(await runAccessGate(recorder, ctx), false);
    assert.match(lastReply(), /Not authorized/);
  });

  // The allowlist governs who may send, not who may read; a group would expose
  // the files Claude prints to every member.
  it("should_reject_an_allowlisted_user_in_a_group", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ userId: 111, chatType: "group" });

    assert.equal(await runAccessGate(recorder, ctx), false);
    assert.match(lastReply(), /only works in a direct message/);
  });

  it("should_reject_an_update_with_no_sender", async () => {
    const { recorder } = await harness();
    const { ctx } = fakeContext({ userId: undefined });
    assert.equal(await runAccessGate(recorder, ctx), false);
  });

  it("should_not_reveal_the_private_chat_rule_to_a_stranger_in_a_group", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ userId: 999, chatType: "group" });

    await runAccessGate(recorder, ctx);
    assert.match(lastReply(), /Not authorized/);
    assert.equal(lastReply().includes("direct message"), false);
  });
});

describe("/id", () => {
  it("should_report_the_callers_own_identifiers", async () => {
    const { recorder } = await harness();
    const { ctx, lastReply } = fakeContext({ userId: 999, chatId: 42 });
    await recorder.run("id", ctx);

    assert.match(lastReply(), /999/);
    assert.match(lastReply(), /42/);
  });

  // It is the only way a new operator can discover the value ALLOWED_USERS
  // needs, so it has to sit ahead of the gate that requires it.
  it("should_be_registered_before_the_access_gate", async () => {
    const { recorder } = await harness();
    const idIndex = recorder.registrations.indexOf("command:id");
    const gateIndex = recorder.registrations.indexOf("use");

    assert.notEqual(idIndex, -1);
    assert.notEqual(gateIndex, -1);
    assert.ok(idIndex < gateIndex, "/id must be registered before the allowlist");
  });
});

describe("text messages", () => {
  const runText = async (
    recorder: Awaited<ReturnType<typeof harness>>["recorder"],
    ctx: FakeContext,
  ) => {
    const handler = recorder.textHandlers[0];
    assert.ok(handler, "a text handler must be registered");
    await handler(ctx, async () => undefined);
  };

  it("should_forward_plain_text_to_the_agent", async () => {
    const { recorder, agents } = await harness();
    const { ctx, replies } = fakeContext({ text: "add a health endpoint" });

    await runText(recorder, ctx);

    assert.deepEqual(agents.last()?.sent, ["add a health endpoint"]);
    assert.deepEqual(replies, []);
  });

  it("should_forward_a_bundled_slash_command_to_the_agent", async () => {
    const { recorder, agents } = await harness();
    const { ctx, replies } = fakeContext({ text: "/pocketclaude-config:commit" });

    await runText(recorder, ctx);

    assert.deepEqual(agents.last()?.sent, ["/pocketclaude-config:commit"]);
    assert.deepEqual(replies, []);
  });

  it("should_still_route_the_bots_own_commands_to_their_handlers", async () => {
    const { recorder } = await harness();

    for (const name of ["pwd", "cd", "ls", "new", "stop", "status", "get"]) {
      assert.ok(recorder.commands.has(name), `/${name} must stay a command handler`);
    }
  });

  it("should_tell_the_user_when_a_message_is_queued", async () => {
    const { recorder, sessions, agents } = await harness();
    await sessions.get(1);
    const agent = agents.last();
    if (agent) agent.busy = true;

    const { ctx, lastReply } = fakeContext({ text: "second message" });
    await runText(recorder, ctx);

    assert.match(lastReply(), /Queued/);
  });

  it("should_keep_each_chat_on_its_own_agent", async () => {
    const { recorder, agents } = await harness();
    await runText(recorder, fakeContext({ chatId: 1, text: "one" }).ctx);
    await runText(recorder, fakeContext({ chatId: 2, text: "two" }).ctx);

    assert.equal(agents.created.length, 2);
    assert.deepEqual(agents.created[0]?.sent, ["one"]);
    assert.deepEqual(agents.created[1]?.sent, ["two"]);
  });
});
