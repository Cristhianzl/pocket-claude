import fs from "node:fs/promises";
import { Bot } from "grammy";
import { ACCESS_MESSAGES, decideAccess } from "./access.js";
import { registerCommands } from "./commands.js";
import { type Config, ConfigError, loadConfig } from "./config.js";
import { log } from "./logger.js";
import { SessionManager } from "./sessions.js";
import { StateStore } from "./store.js";

/**
 * Takes the bot rather than creating it: the SessionManager writes through the
 * same instance that polls, so they must not be separate objects.
 */
function registerHandlers(bot: Bot, config: Config, sessions: SessionManager): void {
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

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      await ctx.reply("Unknown command. /help lists what is available.");
      return;
    }

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

async function main(): Promise<void> {
  const config = loadConfig();

  const approved = await fs.stat(config.approvedDirectory).catch(() => null);
  if (!approved?.isDirectory()) {
    throw new ConfigError(`APPROVED_DIRECTORY is not a directory: ${config.approvedDirectory}`);
  }

  const bot = new Bot(config.botToken);
  const sessions = new SessionManager(bot, config, new StateStore(config.stateFile));
  registerHandlers(bot, config, sessions);

  await bot.init();
  if (bot.botInfo.username !== config.botUsername) {
    log.warn("TELEGRAM_BOT_USERNAME does not match the token", {
      configured: config.botUsername,
      actual: bot.botInfo.username,
    });
  }

  log.info("TeleClaude started", {
    bot: `@${bot.botInfo.username}`,
    approved_directory: config.approvedDirectory,
    allowed_users: [...config.allowedUsers].join(","),
  });
  log.warn("permissionMode=bypassPermissions — Claude executes without confirmation");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    await bot.stop();
    await sessions.disposeAll();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await bot.start();
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    log.error(error.message);
  } else {
    log.error("startup failed", { error: error instanceof Error ? error.stack : String(error) });
  }
  process.exit(1);
});
