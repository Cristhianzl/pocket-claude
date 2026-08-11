import type { Bot } from "grammy";
import { ACCESS_MESSAGES, decideAccess } from "./access.js";
import { registerCommands } from "./commands.js";
import type { Config } from "./config.js";
import { log } from "./logger.js";
import type { SessionManager } from "./sessions.js";

/**
 * Wires the update pipeline onto an existing bot. It takes the bot rather than
 * creating one because the SessionManager writes through the same instance that
 * polls; two objects would send replies nobody receives.
 */
export function registerHandlers(bot: Bot, config: Config, sessions: SessionManager): void {
  // Registered before the allowlist: /id is how a new operator discovers the
  // number they need to put in ALLOWED_USERS.
  bot.command("id", async (ctx) => {
    await ctx.reply(
      `Your user ID: <code>${ctx.from?.id ?? "?"}</code>\nChat ID: <code>${ctx.chat.id}</code>`,
      { parse_mode: "HTML" },
    );
  });

  bot.use(async (ctx, next) => {
    const decision = decideAccess(
      { userId: ctx.from?.id, chatType: ctx.chat?.type },
      config.allowedUsers,
    );
    if (!decision.allowed) {
      log.warn("rejected update", {
        reason: decision.reason,
        user_id: ctx.from?.id,
        chat_id: ctx.chat?.id,
      });
      await ctx.reply(ACCESS_MESSAGES[decision.reason]);
      return;
    }
    await next();
  });

  registerCommands(bot, config, sessions);

  // Unmatched `/…` text falls through to Claude so the bundled config's slash
  // commands are reachable.
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const { agent } = await sessions.get(ctx.chat.id);
    const { queued } = agent.send(text);
    await ctx.api.sendChatAction(ctx.chat.id, "typing").catch((error: unknown) => {
      log.warn("chat action failed", { chat_id: ctx.chat.id, error: String(error) });
    });
    if (queued) {
      await ctx.reply("Queued — Claude will get to it after the current turn.");
    }
  });

  bot.catch((error) => {
    log.error("unhandled bot error", { error: String(error) });
  });
}
