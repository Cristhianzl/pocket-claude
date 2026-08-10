import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { SessionManager } from "../src/sessions.js";
import { StateStore } from "../src/store.js";
import { fakeAgentFactory, fakeBot, testConfig } from "./helpers/fakes.js";

async function harness(options: { approvedDirectory?: string } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-claude-sessions-"));
  const store = new StateStore(path.join(dir, "state.json"));
  const telegram = fakeBot();
  const agents = fakeAgentFactory();
  const config = testConfig(
    options.approvedDirectory ? { APPROVED_DIRECTORY: options.approvedDirectory } : {},
  );
  const sessions = new SessionManager(telegram.bot, config, store, agents.factory);
  return { sessions, agents, telegram, store, config };
}

describe("SessionManager creation", () => {
  it("should_start_the_agent_it_creates", async () => {
    const { sessions, agents } = await harness();
    await sessions.get(1);
    assert.equal(agents.created.length, 1);
    assert.equal(agents.last()?.started, true);
  });

  it("should_open_a_new_chat_in_the_approved_directory", async () => {
    const { sessions, agents } = await harness({ approvedDirectory: "/srv/projects" });
    await sessions.get(1);
    assert.equal(agents.last()?.cwd, "/srv/projects");
    assert.equal(agents.last()?.sessionId, null);
  });

  it("should_reuse_the_live_agent_on_later_calls", async () => {
    const { sessions, agents } = await harness();
    const first = await sessions.get(1);
    const second = await sessions.get(1);
    assert.equal(first.agent, second.agent);
    assert.equal(agents.created.length, 1);
  });

  // Regression: without the per-chat lock each concurrent miss spawned an agent,
  // leaking a CLI process.
  it("should_create_a_single_agent_for_concurrent_first_messages", async () => {
    const { sessions, agents } = await harness();
    const entries = await Promise.all([1, 1, 1, 1, 1].map((id) => sessions.get(id)));
    assert.equal(agents.created.length, 1);
    assert.equal(new Set(entries.map((entry) => entry.agent)).size, 1);
  });

  it("should_keep_chats_independent", async () => {
    const { sessions, agents } = await harness();
    await sessions.get(1);
    await sessions.get(2);
    assert.equal(agents.created.length, 2);
  });
});

describe("SessionManager persistence", () => {
  it("should_persist_the_session_id_the_agent_reports", async () => {
    const { sessions, agents, store } = await harness();
    await sessions.get(7);
    agents.last()?.init.onSessionId("session-abc");
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(await store.get(7), { cwd: "/srv/work", sessionId: "session-abc" });
  });

  it("should_resume_a_saved_session_after_a_restart", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pocket-claude-resume-"));
    const file = path.join(dir, "state.json");
    await new StateStore(file).set(3, { cwd: "/srv/api", sessionId: "saved-1" });

    const agents = fakeAgentFactory();
    const sessions = new SessionManager(
      fakeBot().bot,
      testConfig(),
      new StateStore(file),
      agents.factory,
    );
    await sessions.get(3);

    assert.equal(agents.last()?.cwd, "/srv/api");
    assert.equal(agents.last()?.sessionId, "saved-1");
  });
});

describe("SessionManager reset", () => {
  it("should_dispose_the_old_agent_and_start_a_new_one", async () => {
    const { sessions, agents } = await harness();
    await sessions.get(1);
    const first = agents.last();
    await sessions.reset(1);

    assert.equal(first?.disposed, true);
    assert.equal(agents.created.length, 2);
    assert.equal(agents.last()?.started, true);
  });

  it("should_move_the_chat_to_a_new_directory", async () => {
    const { sessions, agents, store } = await harness();
    await sessions.get(1);
    await sessions.reset(1, "/srv/work/api");

    assert.equal(agents.last()?.cwd, "/srv/work/api");
    assert.deepEqual(await store.get(1), { cwd: "/srv/work/api", sessionId: null });
  });

  it("should_keep_the_directory_when_none_is_given", async () => {
    const { sessions, agents } = await harness();
    await sessions.get(1);
    await sessions.reset(1, "/srv/work/api");
    await sessions.reset(1);
    assert.equal(agents.last()?.cwd, "/srv/work/api");
  });

  it("should_drop_the_saved_session_id", async () => {
    const { sessions, agents, store } = await harness();
    await sessions.get(1);
    agents.last()?.init.onSessionId("session-abc");
    await sessions.reset(1);

    assert.equal((await store.get(1))?.sessionId, null);
    assert.equal(agents.last()?.sessionId, null);
  });
});

describe("SessionManager recovery", () => {
  // Regression: a dead agent swallowed every later message, leaving the chat
  // permanently mute with no error.
  it("should_replace_a_dead_agent_on_the_next_message", async () => {
    const { sessions, agents } = await harness();
    const entry = await sessions.get(1);
    const dead = agents.last();
    if (dead) dead.dead = true;

    const replacement = await sessions.get(1);

    assert.notEqual(replacement.agent, entry.agent);
    assert.equal(dead?.disposed, true);
    assert.equal(agents.created.length, 2);
    assert.equal(agents.last()?.started, true);
  });

  it("should_restart_a_replaced_agent_without_resuming", async () => {
    const { sessions, agents, store } = await harness();
    await sessions.get(1);
    agents.last()?.init.onSessionId("session-abc");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const dead = agents.last();
    if (dead) dead.dead = true;

    await sessions.get(1);

    assert.equal(agents.last()?.sessionId, null);
    assert.equal((await store.get(1))?.sessionId, null);
  });

  it("should_keep_the_project_directory_when_replacing_a_dead_agent", async () => {
    const { sessions, agents } = await harness();
    await sessions.reset(1, "/srv/work/api");
    const dead = agents.last();
    if (dead) dead.dead = true;

    await sessions.get(1);
    assert.equal(agents.last()?.cwd, "/srv/work/api");
  });
});

describe("SessionManager output", () => {
  it("should_forward_prose_to_the_chat", async () => {
    const { sessions, agents, telegram } = await harness();
    const entry = await sessions.get(1);
    agents.last()?.emit({ type: "text", text: "All tests pass." });
    await entry.outbox.drain();

    assert.match(telegram.texts().join("\n"), /All tests pass\./);
  });

  it("should_label_cost_as_an_estimate_on_a_subscription", async () => {
    const { sessions, agents, telegram } = await harness();
    const entry = await sessions.get(1);
    agents.last()?.emit({
      type: "done",
      costUsd: 0.0372,
      durationMs: 2300,
      isError: false,
      billedPerToken: false,
    });
    await entry.outbox.drain();

    assert.match(telegram.texts().join("\n"), /~\$0\.0372 est\./);
  });

  it("should_show_a_plain_cost_when_billed_per_token", async () => {
    const { sessions, agents, telegram } = await harness();
    const entry = await sessions.get(1);
    agents.last()?.emit({
      type: "done",
      costUsd: 0.0372,
      durationMs: 2300,
      isError: false,
      billedPerToken: true,
    });
    await entry.outbox.drain();

    const text = telegram.texts().join("\n");
    assert.match(text, /\$0\.0372/);
    assert.equal(text.includes("est."), false);
  });

  it("should_tell_the_user_how_to_recover_from_a_lost_session", async () => {
    const { sessions, agents, telegram } = await harness();
    const entry = await sessions.get(1);
    agents.last()?.emit({ type: "dead", resumeFailed: true });
    await entry.outbox.drain();

    assert.match(telegram.texts().join("\n"), /no longer exists.*Send your message again/s);
  });

  it("should_escape_error_text_before_sending_it", async () => {
    const { sessions, agents, telegram } = await harness();
    const entry = await sessions.get(1);
    agents.last()?.emit({ type: "error", text: "<script>x</script>" });
    await entry.outbox.drain();

    const text = telegram.texts().join("\n");
    assert.equal(text.includes("<script>"), false);
    assert.match(text, /&lt;script&gt;/);
  });
});

describe("SessionManager shutdown", () => {
  it("should_dispose_every_live_agent", async () => {
    const { sessions, agents } = await harness();
    await sessions.get(1);
    await sessions.get(2);
    await sessions.disposeAll();

    assert.deepEqual(
      agents.created.map((agent) => agent.disposed),
      [true, true],
    );
  });

  it("should_start_fresh_after_shutdown", async () => {
    const { sessions, agents } = await harness();
    await sessions.get(1);
    await sessions.disposeAll();
    await sessions.get(1);

    assert.equal(agents.created.length, 2);
  });
});
