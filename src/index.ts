import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot } from "grammy";
import { CONFIG_DIR } from "./agent.js";
import { renderBanner } from "./banner.js";
import { registerHandlers } from "./bot.js";
import { ConfigError, loadConfig } from "./config.js";
import { log } from "./logger.js";
import { SessionManager } from "./sessions.js";
import { StatusLine } from "./statusline.js";
import { StateStore } from "./store.js";

/** Read rather than hardcoded: a second copy of the version always drifts. */
const VERSION = String(createRequire(import.meta.url)("../package.json").version ?? "0.0.0");

async function countEntries(directory: string): Promise<number> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => !entry.name.startsWith(".")).length;
}

function shortenHome(target: string): string {
  const home = os.homedir();
  return target.startsWith(home) ? `~${target.slice(home.length)}` : target;
}

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

  const store = new StateStore(config.stateFile);
  const sessions = new SessionManager(bot, config, store);
  registerHandlers(bot, config, sessions);

  await bot.init();
  if (bot.botInfo.username !== config.botUsername) {
    log.warn("TELEGRAM_BOT_USERNAME does not match the token", {
      configured: config.botUsername,
      actual: bot.botInfo.username,
    });
  }

  const decorated = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  if (decorated) {
    process.stdout.write(
      renderBanner(
        {
          version: VERSION,
          bot: `@${bot.botInfo.username}`,
          model: config.model ?? "Claude Code default",
          root: shortenHome(config.approvedDirectory),
          users: config.allowedUsers.size,
          skills: await countEntries(path.join(CONFIG_DIR, "skills")),
          commands: await countEntries(path.join(CONFIG_DIR, "commands")),
          chats: await store.count(),
        },
        { color: true },
      ),
    );
  } else {
    log.info("PocketClaude started", {
      bot: `@${bot.botInfo.username}`,
      approved_directory: config.approvedDirectory,
      allowed_users: [...config.allowedUsers].join(","),
    });
    log.warn("permissionMode=bypassPermissions — Claude executes without confirmation");
  }

  const status = decorated ? new StatusLine({ read: () => sessions.stats(), color: true }) : null;
  status?.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    status?.stop();
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
