import type { Bot } from "grammy";
import { type AgentInit, ChatAgent } from "./agent.js";
import type { Config } from "./config.js";
import { log } from "./logger.js";
import { KeyedMutex } from "./mutex.js";
import { Outbox } from "./outbox.js";
import { escapeHtml } from "./render.js";
import type { StateStore } from "./store.js";

export type Entry = { agent: ChatAgent; outbox: Outbox };

/** Injectable so tests can drive session handling without the Claude SDK. */
export type AgentFactory = (init: AgentInit) => ChatAgent;

/**
 * One live ChatAgent per Telegram chat. Sessions are created lazily and resumed
 * from disk, so restarting the bot does not lose conversation context.
 */
export class SessionManager {
  #bot: Bot;
  #config: Config;
  #store: StateStore;
  #entries = new Map<number, Entry>();
  #mutex = new KeyedMutex<number>();
  #createAgent: AgentFactory;

  constructor(bot: Bot, config: Config, store: StateStore, createAgent?: AgentFactory) {
    this.#bot = bot;
    this.#config = config;
    this.#store = store;
    this.#createAgent = createAgent ?? ((init) => new ChatAgent(init));
  }

  get(chatId: number): Promise<Entry> {
    return this.#mutex.run(chatId, async () => {
      const existing = this.#entries.get(chatId);
      if (existing && !existing.agent.dead) return existing;

      // A dead agent silently swallows everything pushed into it, so it is
      // replaced rather than reused. Its session is gone either way.
      if (existing) {
        this.#entries.delete(chatId);
        await existing.agent.dispose();
        await this.#store.set(chatId, { cwd: existing.agent.cwd, sessionId: null });
        log.warn("replacing dead agent", { chat_id: chatId });
        return this.#spawn(chatId, existing.agent.cwd, null);
      }

      const saved = await this.#store.get(chatId);
      return this.#spawn(
        chatId,
        saved?.cwd ?? this.#config.approvedDirectory,
        saved?.sessionId ?? null,
      );
    });
  }

  /** Drops the current session and starts a fresh one, optionally elsewhere. */
  reset(chatId: number, cwd?: string): Promise<Entry> {
    return this.#mutex.run(chatId, async () => {
      const existing = this.#entries.get(chatId);
      const nextCwd =
        cwd ??
        existing?.agent.cwd ??
        (await this.#store.get(chatId))?.cwd ??
        this.#config.approvedDirectory;

      if (existing) {
        this.#entries.delete(chatId);
        await existing.agent.dispose();
      }
      await this.#store.set(chatId, { cwd: nextCwd, sessionId: null });
      return this.#spawn(chatId, nextCwd, null);
    });
  }

  #spawn(chatId: number, cwd: string, sessionId: string | null): Entry {
    const outbox = new Outbox(this.#bot, chatId);

    const agent = this.#createAgent({
      chatId,
      cwd,
      sessionId,
      model: this.#config.model,
      onSessionId: (id) => {
        void this.#store.set(chatId, { cwd, sessionId: id }).catch((error: unknown) => {
          log.error("failed to persist session", { chat_id: chatId, error: String(error) });
        });
      },
      emit: (event) => {
        switch (event.type) {
          case "text":
            outbox.markdown(event.text);
            break;
          case "activity":
            outbox.activity(event.text);
            break;
          case "done":
            outbox.notice(renderDone(event));
            break;
          case "error":
            outbox.notice(`<b>error:</b> ${escapeHtml(event.text)}`);
            break;
          case "dead":
            outbox.notice(
              event.resumeFailed
                ? "That saved session no longer exists. Send your message again to start a fresh one."
                : "The Claude session ended. Send your message again to start a fresh one.",
            );
            break;
          case "session":
            break;
        }
      },
    });

    agent.start();
    const entry: Entry = { agent, outbox };
    this.#entries.set(chatId, entry);
    return entry;
  }

  async disposeAll(): Promise<void> {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    await Promise.all(
      entries.map(async ({ agent, outbox }) => {
        await outbox.drain();
        await agent.dispose();
      }),
    );
  }
}

function renderDone(event: {
  isError: boolean;
  detail?: string;
  durationMs: number;
  costUsd: number;
  billedPerToken: boolean;
}): string {
  if (event.isError) return `<b>turn ended:</b> ${escapeHtml(event.detail ?? "error")}`;
  const seconds = (event.durationMs / 1000).toFixed(1);
  // On a subscription login the SDK's figure is a list-price estimate, not a
  // charge — label it so it does not read as a bill.
  const cost = event.billedPerToken
    ? `$${event.costUsd.toFixed(4)}`
    : `~$${event.costUsd.toFixed(4)} est.`;
  return `<i>done · ${seconds}s · ${cost}</i>`;
}
