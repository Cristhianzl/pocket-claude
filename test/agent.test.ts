import assert from "node:assert/strict";
import { sep } from "node:path";
import { describe, it } from "node:test";
import { type AgentEvent, ChatAgent } from "../src/agent.js";
import {
  assistantMessage,
  initMessage,
  makeFakeQuery,
  resultMessage,
  type Script,
} from "./helpers/fake-query.js";

type Harness = {
  agent: ChatAgent;
  events: AgentEvent[];
  sessionIds: string[];
  calls: ReturnType<typeof makeFakeQuery>["calls"];
  interrupts: () => number;
  settled: (predicate: () => boolean) => Promise<void>;
};

function harness(options: {
  script?: Script;
  onStart?: ReturnType<typeof initMessage>[];
  throwOnStart?: Error;
  sessionId?: string | null;
  cwd?: string;
  model?: string;
}): Harness {
  const events: AgentEvent[] = [];
  const sessionIds: string[] = [];
  const fake = makeFakeQuery({
    script: options.script ?? (() => [resultMessage()]),
    onStart: options.onStart ?? [initMessage()],
    ...(options.throwOnStart ? { throwOnStart: options.throwOnStart } : {}),
  });

  const agent = new ChatAgent({
    chatId: 1,
    cwd: options.cwd ?? "/srv/work",
    sessionId: options.sessionId ?? null,
    ...(options.model ? { model: options.model } : {}),
    queryFn: fake.queryFn,
    emit: (event) => events.push(event),
    onSessionId: (id) => sessionIds.push(id),
  });
  agent.start();

  const settled = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("condition never became true");
  };

  return { agent, events, sessionIds, calls: fake.calls, interrupts: fake.interrupts, settled };
}

const typesOf = (events: AgentEvent[]) => events.map((event) => event.type);

describe("ChatAgent start options", () => {
  it("should_always_request_bypass_permissions", async () => {
    const { calls, settled } = harness({});
    await settled(() => calls.length === 1);
    assert.equal(calls[0]?.permissionMode, "bypassPermissions");
    assert.equal(calls[0]?.allowDangerouslySkipPermissions, true);
  });

  it("should_pass_the_project_directory_through", async () => {
    const { calls, settled } = harness({ cwd: "/srv/api" });
    await settled(() => calls.length === 1);
    assert.equal(calls[0]?.cwd, "/srv/api");
  });

  it("should_resume_when_a_session_id_is_known", async () => {
    const { calls, settled } = harness({ sessionId: "prev-session" });
    await settled(() => calls.length === 1);
    assert.equal(calls[0]?.resume, "prev-session");
  });

  it("should_omit_resume_for_a_fresh_session", async () => {
    const { calls, settled } = harness({ sessionId: null });
    await settled(() => calls.length === 1);
    assert.equal("resume" in (calls[0] ?? {}), false);
  });

  it("should_omit_the_model_when_not_overridden", async () => {
    const { calls, settled } = harness({});
    await settled(() => calls.length === 1);
    assert.equal("model" in (calls[0] ?? {}), false);
  });

  it("should_forward_a_model_override", async () => {
    const { calls, settled } = harness({ model: "claude-sonnet-5" });
    await settled(() => calls.length === 1);
    assert.equal(calls[0]?.model, "claude-sonnet-5");
  });

  it("should_load_the_bundled_config_as_a_plugin", async () => {
    const { calls, settled } = harness({ cwd: "/srv/api" });
    await settled(() => calls.length === 1);
    const plugin = calls[0]?.plugins?.[0];
    assert.equal(plugin?.type, "local");
    assert.ok(
      plugin?.path.endsWith(`${sep}.claude`),
      `expected the bundled config directory, got ${plugin?.path}`,
    );
  });

  it("should_resolve_the_plugin_outside_the_project_directory", async () => {
    const { calls, settled } = harness({ cwd: "/srv/api" });
    await settled(() => calls.length === 1);
    assert.equal(calls[0]?.plugins?.[0]?.path.startsWith("/srv/api"), false);
  });

  it("should_append_the_baseline_to_the_claude_code_preset", async () => {
    const { calls, settled } = harness({});
    await settled(() => calls.length === 1);
    assert.equal(calls[0]?.systemPrompt?.type, "preset");
    assert.equal(calls[0]?.systemPrompt?.preset, "claude_code");
    assert.match(calls[0]?.systemPrompt?.append ?? "", /CLAUDE\.md/);
  });

  it("should_keep_filesystem_settings_enabled", async () => {
    const { calls, settled } = harness({});
    await settled(() => calls.length === 1);
    assert.deepEqual(calls[0]?.settingSources, ["user", "project", "local"]);
  });
});

describe("ChatAgent message handling", () => {
  it("should_record_session_details_from_the_init_message", async () => {
    const { agent, sessionIds, settled } = harness({});
    await settled(() => agent.model !== "");

    assert.equal(agent.sessionId, "session-1");
    assert.equal(agent.model, "claude-opus-5");
    assert.equal(agent.apiKeySource, "none");
    assert.deepEqual(sessionIds, ["session-1"]);
  });

  it("should_emit_prose_and_tool_calls_separately", async () => {
    const { agent, events, settled } = harness({
      script: () => [
        assistantMessage([
          { type: "text", text: "Checking the tests." },
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
        ]),
        resultMessage(),
      ],
    });

    agent.send("run the tests");
    await settled(() => typesOf(events).includes("done"));

    const text = events.find((event) => event.type === "text");
    const activity = events.find((event) => event.type === "activity");
    assert.equal(text?.type === "text" && text.text, "Checking the tests.");
    assert.equal(activity?.type === "activity" && activity.text, "$ npm test");
  });

  it("should_ignore_assistant_text_that_is_only_whitespace", async () => {
    const { agent, events, settled } = harness({
      script: () => [assistantMessage([{ type: "text", text: "   " }]), resultMessage()],
    });

    agent.send("hi");
    await settled(() => typesOf(events).includes("done"));
    assert.equal(typesOf(events).includes("text"), false);
  });

  it("should_report_cost_as_an_estimate_on_a_subscription_login", async () => {
    const { agent, events, settled } = harness({});
    agent.send("hi");
    await settled(() => typesOf(events).includes("done"));

    const done = events.find((event) => event.type === "done");
    assert.equal(done?.type === "done" && done.billedPerToken, false);
  });

  it("should_report_cost_as_billed_when_an_api_key_is_in_use", async () => {
    const { agent, events, settled } = harness({
      onStart: [initMessage({ apiKeySource: "user" })],
    });
    agent.send("hi");
    await settled(() => typesOf(events).includes("done"));

    const done = events.find((event) => event.type === "done");
    assert.equal(done?.type === "done" && done.billedPerToken, true);
  });

  it("should_flag_a_failed_turn_with_its_subtype", async () => {
    const { agent, events, settled } = harness({
      script: () => [resultMessage({ subtype: "error_during_execution", is_error: true })],
    });

    agent.send("hi");
    await settled(() => typesOf(events).includes("done"));

    const done = events.find((event) => event.type === "done");
    assert.equal(done?.type === "done" && done.isError, true);
    assert.equal(done?.type === "done" && done.detail, "error_during_execution");
  });
});

describe("ChatAgent turn tracking", () => {
  it("should_report_busy_between_send_and_result", async () => {
    const { agent, events, settled } = harness({});
    assert.equal(agent.busy, false);

    agent.send("hi");
    assert.equal(agent.busy, true);

    await settled(() => typesOf(events).includes("done"));
    assert.equal(agent.busy, false);
  });

  it("should_mark_a_second_message_as_queued_while_a_turn_runs", () => {
    const { agent } = harness({});
    assert.deepEqual(agent.send("first"), { queued: false });
    assert.deepEqual(agent.send("second"), { queued: true });
  });

  it("should_stay_busy_until_every_queued_turn_resolves", async () => {
    let releaseSecondTurn: (() => void) | undefined;
    const secondTurn = new Promise<void>((resolve) => {
      releaseSecondTurn = resolve;
    });

    const { agent, events, settled } = harness({
      script: async (_text, turn) => {
        if (turn === 1) await secondTurn;
        return [resultMessage()];
      },
    });

    agent.send("first");
    agent.send("second");

    await settled(() => events.filter((event) => event.type === "done").length === 1);
    assert.equal(agent.busy, true, "a queued turn is still outstanding");

    releaseSecondTurn?.();
    await settled(() => events.filter((event) => event.type === "done").length === 2);
    assert.equal(agent.busy, false);
  });

  it("should_forward_interrupt_to_the_query", async () => {
    const { agent, interrupts, calls, settled } = harness({});
    await settled(() => calls.length === 1);
    await agent.interrupt();
    assert.equal(interrupts(), 1);
  });
});

describe("ChatAgent death and recovery", () => {
  // Regression: a dead agent silently swallows everything pushed into it, so it
  // must announce itself instead of leaving the chat mute.
  it("should_announce_death_when_the_query_ends", async () => {
    const { agent, events, settled } = harness({ throwOnStart: new Error("transport closed") });
    await settled(() => typesOf(events).includes("dead"));

    assert.equal(agent.dead, true);
    assert.equal(agent.busy, false);
    const dead = events.find((event) => event.type === "dead");
    assert.equal(dead?.type === "dead" && dead.resumeFailed, false);
  });

  it("should_flag_a_missing_session_so_the_caller_can_start_fresh", async () => {
    const { events, settled } = harness({
      sessionId: "gone",
      throwOnStart: new Error("No conversation found with session ID: gone"),
    });
    await settled(() => typesOf(events).includes("dead"));

    const dead = events.find((event) => event.type === "dead");
    assert.equal(dead?.type === "dead" && dead.resumeFailed, true);
  });

  it("should_detect_a_missing_session_reported_as_a_result", async () => {
    const { agent, events, settled } = harness({
      sessionId: "gone",
      script: () => [
        resultMessage({
          subtype: "error_during_execution",
          is_error: true,
          result: "No conversation found with session ID: gone",
        }),
      ],
    });

    agent.send("hi");
    await settled(() => typesOf(events).includes("done"));
    await agent.dispose();

    assert.equal(agent.dead, true);
  });

  it("should_surface_the_underlying_error_before_dying", async () => {
    const { events, settled } = harness({ throwOnStart: new Error("boom") });
    await settled(() => typesOf(events).includes("dead"));

    const error = events.find((event) => event.type === "error");
    assert.equal(error?.type === "error" && error.text, "boom");
  });

  it("should_not_announce_death_when_disposed_on_purpose", async () => {
    const { agent, events, calls, settled } = harness({});
    await settled(() => calls.length === 1);
    await agent.dispose();

    assert.equal(agent.dead, true);
    assert.equal(typesOf(events).includes("dead"), false);
  });
});
