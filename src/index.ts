import fs from "node:fs/promises";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot } from "grammy";
import { registerHandlers } from "./bot.js";
import { ConfigError, loadConfig } from "./config.js";
import { log } from "./logger.js";
import { SessionManager } from "./sessions.js";
import { StateStore } from "./store.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const approved = await fs.stat(config.approvedDirectory).catch(() => null);
  if (!approved?.isDirectory()) {
    throw new ConfigError(`APPROVED_DIRECTORY is not a directory: ${config.approvedDirectory}`);
  }

  const bot = new Bot(config.botToken);

  // Honours Telegram's `retry_after` on 429 rather than re-implementing flood
  // control ourselves; a busy turn bursts messages and status edits.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  const sessions = new SessionManager(bot, config, new StateStore(config.stateFile));
  registerHandlers(bot, config, sessions);

  await bot.init();
  if (bot.botInfo.username !== config.botUsername) {
    log.warn("TELEGRAM_BOT_USERNAME does not match the token", {
      configured: config.botUsername,
      actual: bot.botInfo.username,
    });
  }

  log.info("PocketClaude started", {
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
