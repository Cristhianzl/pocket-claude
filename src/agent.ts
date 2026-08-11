import { type Query, query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { InputStream } from "./input-stream.js";
import { describeToolUse } from "./render.js";

/**
 * Resolved from this module, not from `cwd`: the agent's `cwd` is the chat's
 * project, so config found there would differ per chat. This one ships with the
 * bot and reaches every session.
 */
const CONFIG_DIR = fileURLToPath(new URL("../.claude", import.meta.url));

const BASELINE_PATH = join(CONFIG_DIR, "CLAUDE.md");
const BASELINE = existsSync(BASELINE_PATH)
  ? readFileSync(BASELINE_PATH, { encoding: "utf-8" })
  : undefined;

export type AgentEvent =
  /** Prose the assistant wrote for the user. */
  | { type: "text"; text: string }
  /** An intermediate step (a tool call). */
  | { type: "activity"; text: string }
  /** End of a turn. */
  | {
      type: "done";
      costUsd: number;
      durationMs: number;
      isError: boolean;
      detail?: string;
      /** False on a subscription login, where `costUsd` is a list-price estimate. */
      billedPerToken: boolean;
    }
  | { type: "error"; text: string }
  /** The underlying query ended; this agent can no longer be used. */
  | { type: "dead"; resumeFailed: boolean }
  | { type: "session"; sessionId: string; cwd: string; model: string };

/** The `query` entry point, injectable so tests can drive the agent loop. */
export type QueryFn = typeof query;

export type AgentInit = {
  chatId: number;
  cwd: string;
  sessionId: string | null;
  /** Overrides the model; when omitted, Claude Code's default is used. */
  model?: string | undefined;
  emit: (event: AgentEvent) => void;
  onSessionId: (sessionId: string) => void;
  queryFn?: QueryFn;
};

/** A resumed session whose transcript no longer exists cannot be recovered. */
function isMissingSessionError(text: string): boolean {
  return /no conversation found with session id/i.test(text);
}

export class ChatAgent {
  readonly chatId: number;
  readonly cwd: string;
  sessionId: string | null;

  /** True between sending a prompt and receiving its matching `result`. */
  busy = false;
  /**
   * True once the underlying query has ended. A dead agent silently swallows
   * everything pushed into it, so callers must replace it rather than reuse it.
   */
  dead = false;
  totalCostUsd = 0;
  model = "";
  /**
   * Where credentials came from. `'none'` means a Claude Code subscription
   * login, in which case reported costs are list-price estimates, not charges.
   */
  apiKeySource = "";

  #input = new InputStream();
  #query: Query | null = null;
  #loop: Promise<void> | null = null;
  #modelOverride: string | undefined;
  #emit: AgentInit["emit"];
  #onSessionId: AgentInit["onSessionId"];
  #pendingTurns = 0;
  #resumeFailed = false;
  #disposing = false;
  #queryFn: QueryFn;

  constructor(init: AgentInit) {
    this.chatId = init.chatId;
    this.cwd = init.cwd;
    this.sessionId = init.sessionId;
    this.#modelOverride = init.model;
    this.#emit = init.emit;
    this.#onSessionId = init.onSessionId;
    this.#queryFn = init.queryFn ?? query;
  }

  start(): void {
    this.#query = this.#queryFn({
      prompt: this.#input.stream(),
      options: {
        cwd: this.cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        settingSources: ["user", "project", "local"],
        plugins: [{ type: "local", path: CONFIG_DIR }],
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          ...(BASELINE ? { append: BASELINE } : {}),
        },
        ...(this.sessionId ? { resume: this.sessionId } : {}),
        ...(this.#modelOverride ? { model: this.#modelOverride } : {}),
      },
    });
    this.#loop = this.#consume();
  }

  /** Returns `queued: true` when a turn was already in flight. */
  send(text: string): { queued: boolean } {
    const wasBusy = this.busy;
    this.#pendingTurns += 1;
    this.busy = true;
    this.#input.push(text);
    return { queued: wasBusy };
  }

  async interrupt(): Promise<void> {
    await this.#query?.interrupt();
  }

  async dispose(): Promise<void> {
    this.#disposing = true;
    this.#input.close();
    try {
      await this.#query?.return(undefined);
    } catch {
      // The generator may already have finished.
    }
    try {
      await this.#loop;
    } catch {
      // Loop errors were already emitted as events.
    }
  }

  async #consume(): Promise<void> {
    if (!this.#query) return;
    try {
      for await (const message of this.#query) {
        this.#handle(message);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (isMissingSessionError(text)) this.#resumeFailed = true;
      this.#emit({ type: "error", text });
    } finally {
      // The query is gone either way, so any turn still counted as in flight
      // will never receive its `result`.
      this.dead = true;
      this.busy = false;
      this.#pendingTurns = 0;
      if (!this.#disposing) {
        this.#emit({ type: "dead", resumeFailed: this.#resumeFailed });
      }
    }
  }

  #handle(message: SDKMessage): void {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") this.#handleInit(message);
        return;

      case "assistant":
        this.#handleAssistant(message);
        return;

      case "result":
        this.#handleResult(message);
        return;

      default:
        return;
    }
  }

  #handleInit(message: Extract<SDKMessage, { type: "system"; subtype: "init" }>): void {
    this.model = message.model;
    this.apiKeySource = message.apiKeySource;
    if (message.session_id && message.session_id !== this.sessionId) {
      this.sessionId = message.session_id;
      this.#onSessionId(message.session_id);
    }
    this.#emit({
      type: "session",
      sessionId: message.session_id,
      cwd: message.cwd,
      model: message.model,
    });
  }

  #handleAssistant(message: Extract<SDKMessage, { type: "assistant" }>): void {
    for (const block of message.message.content) {
      if (block.type === "text" && block.text.trim()) {
        this.#emit({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        this.#emit({
          type: "activity",
          text: describeToolUse(block.name, (block.input ?? {}) as Record<string, unknown>),
        });
      }
    }
  }

  #handleResult(message: Extract<SDKMessage, { type: "result" }>): void {
    this.#pendingTurns = Math.max(0, this.#pendingTurns - 1);
    this.busy = this.#pendingTurns > 0;
    this.totalCostUsd = message.total_cost_usd ?? this.totalCostUsd;

    const failed = message.is_error === true || message.subtype !== "success";
    if (failed && "result" in message && isMissingSessionError(String(message.result))) {
      this.#resumeFailed = true;
    }

    this.#emit({
      type: "done",
      costUsd: message.total_cost_usd ?? 0,
      durationMs: message.duration_ms ?? 0,
      isError: failed,
      detail: message.subtype === "success" ? undefined : message.subtype,
      billedPerToken: this.apiKeySource !== "none" && this.apiKeySource !== "",
    });
  }
}
