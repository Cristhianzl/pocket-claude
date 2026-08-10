import type { Bot } from "grammy";
import type { AgentEvent, AgentInit, ChatAgent } from "../../src/agent.js";
import { buildConfig, type Config } from "../../src/config.js";

export type TelegramCall = {
  method: "send" | "edit" | "document" | "chatAction";
  text: string;
  parseMode?: string;
};

export function fakeBot(options: { rejectHtml?: boolean } = {}) {
  const calls: TelegramCall[] = [];
  let rejectHtml = options.rejectHtml ?? false;
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
      sendChatAction: async () => true,
    },
  };

  return {
    bot: bot as unknown as Bot,
    calls,
    texts: () => calls.map((call) => call.text),
    setRejectHtml: (value: boolean) => {
      rejectHtml = value;
    },
  };
}

export type FakeAgent = {
  init: AgentInit;
  cwd: string;
  dead: boolean;
  busy: boolean;
  sessionId: string | null;
  model: string;
  apiKeySource: string;
  totalCostUsd: number;
  started: boolean;
  disposed: boolean;
  interrupted: number;
  sent: string[];
  emit: (event: AgentEvent) => void;
  start: () => void;
  dispose: () => Promise<void>;
  interrupt: () => Promise<void>;
  send: (text: string) => { queued: boolean };
};

/** Records what SessionManager does to an agent without touching the SDK. */
export function fakeAgentFactory() {
  const created: FakeAgent[] = [];

  const factory = (init: AgentInit): ChatAgent => {
    const agent: FakeAgent = {
      init,
      cwd: init.cwd,
      dead: false,
      busy: false,
      sessionId: init.sessionId,
      model: "claude-opus-5",
      apiKeySource: "none",
      totalCostUsd: 0,
      started: false,
      disposed: false,
      interrupted: 0,
      sent: [],
      emit: (event) => init.emit(event),
      start: () => {
        agent.started = true;
      },
      dispose: async () => {
        agent.disposed = true;
      },
      interrupt: async () => {
        agent.interrupted += 1;
      },
      send: (text) => {
        agent.sent.push(text);
        return { queued: agent.busy };
      },
    };
    created.push(agent);
    return agent as unknown as ChatAgent;
  };

  return { factory, created, last: () => created.at(-1) };
}

export function testConfig(overrides: Partial<Record<string, string>> = {}): Config {
  return buildConfig({
    TELEGRAM_BOT_TOKEN: "9876543210:XYZ-real-token-value-abcdefghij",
    TELEGRAM_BOT_USERNAME: "real_bot",
    APPROVED_DIRECTORY: "/srv/work",
    ALLOWED_USERS: "111",
    ...overrides,
  });
}
