import type { Bot } from "grammy";

type Handler = (ctx: FakeContext, next: () => Promise<void>) => Promise<void>;

export type Reply = { text: string; parseMode?: string };

export type FakeContext = {
  match: string;
  chat: { id: number; type: string };
  from: { id: number } | undefined;
  message: { text: string };
  reply: (text: string, opts?: { parse_mode?: string }) => Promise<void>;
  replyWithDocument: (document: unknown) => Promise<void>;
  api: { sendChatAction: (chatId: number, action: string) => Promise<boolean> };
};

/** Captures the handlers a module registers so tests can invoke them directly. */
export function recordingBot() {
  const commands = new Map<string, Handler>();
  const middlewares: Handler[] = [];
  const textHandlers: Handler[] = [];
  const registrations: string[] = [];

  const bot = {
    command: (name: string | string[], handler: Handler) => {
      for (const single of Array.isArray(name) ? name : [name]) {
        commands.set(single, handler);
        registrations.push(`command:${single}`);
      }
    },
    use: (handler: Handler) => {
      middlewares.push(handler);
      registrations.push("use");
    },
    on: (_filter: string, handler: Handler) => {
      textHandlers.push(handler);
    },
    catch: () => undefined,
  };

  return {
    bot: bot as unknown as Bot,
    commands,
    middlewares,
    textHandlers,
    registrations,
    /** Runs a command handler, or throws if the module never registered it. */
    run: async (name: string, ctx: FakeContext): Promise<void> => {
      const handler = commands.get(name);
      if (!handler) throw new Error(`command /${name} was never registered`);
      await handler(ctx, async () => undefined);
    },
  };
}

export function fakeContext(
  options: {
    match?: string;
    chatId?: number;
    chatType?: string;
    userId?: number | undefined;
    text?: string;
  } = {},
) {
  const replies: Reply[] = [];
  const documents: unknown[] = [];

  const ctx: FakeContext = {
    match: options.match ?? "",
    chat: { id: options.chatId ?? 1, type: options.chatType ?? "private" },
    from:
      "userId" in options && options.userId === undefined
        ? undefined
        : { id: options.userId ?? 111 },
    message: { text: options.text ?? "" },
    reply: async (text, opts) => {
      replies.push({ text, parseMode: opts?.parse_mode });
    },
    replyWithDocument: async (document) => {
      documents.push(document);
    },
    api: { sendChatAction: async () => true },
  };

  return { ctx, replies, documents, lastReply: () => replies.at(-1)?.text ?? "" };
}
