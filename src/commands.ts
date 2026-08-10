import fs from "node:fs/promises";
import path from "node:path";
import { type Bot, InputFile } from "grammy";
import type { Config } from "./config.js";
import { resolveWithinRoot } from "./paths.js";
import { escapeHtml } from "./render.js";
import type { SessionManager } from "./sessions.js";

const MAX_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_LISTED_ENTRIES = 100;

export const HELP = `<b>PocketClaude</b> — Claude Code from Telegram.

Send any text and it becomes a prompt for Claude in the current project.

<b>Project</b>
/pwd — current directory
/cd &lt;path&gt; — switch project (starts a fresh session)
/ls [path] — list a directory
/projects — projects under the approved directory

<b>Session</b>
/new — drop the context and start over
/stop — interrupt whatever Claude is doing
/status — session, model and accumulated cost

<b>Files</b>
/get &lt;path&gt; — download a file from the machine

/id — show your Telegram user ID`;

function outsideRootMessage(config: Config): string {
  return `Outside APPROVED_DIRECTORY (<code>${escapeHtml(config.approvedDirectory)}</code>).`;
}

/** Shared by every command that takes a path, so they reject identically. */
function pathProblemMessage(
  config: Config,
  reason: "outside-root" | "not-found",
  missing: string,
): string {
  return reason === "outside-root" ? outsideRootMessage(config) : missing;
}

/** Returns why `target` cannot be sent to Telegram, or null when it can. */
async function describeUploadProblem(target: string): Promise<string | null> {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) return "That is not a file.";
  if (stat.size > MAX_UPLOAD_BYTES) {
    return "File is larger than 45 MB — Telegram will not accept it.";
  }
  return null;
}

export function registerCommands(bot: Bot, config: Config, sessions: SessionManager): void {
  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(HELP, { parse_mode: "HTML" });
  });

  bot.command("pwd", async (ctx) => {
    const { agent } = await sessions.get(ctx.chat.id);
    await ctx.reply(`<code>${escapeHtml(agent.cwd)}</code>`, { parse_mode: "HTML" });
  });

  bot.command("cd", async (ctx) => {
    const raw = ctx.match.trim();
    if (!raw) {
      await ctx.reply("Usage: /cd path/to/project");
      return;
    }

    const { agent } = await sessions.get(ctx.chat.id);
    const resolved = await resolveWithinRoot(raw, agent.cwd, config.approvedDirectory);
    if (!resolved.ok) {
      await ctx.reply(pathProblemMessage(config, resolved.reason, "Directory not found."), {
        parse_mode: "HTML",
      });
      return;
    }

    const stat = await fs.stat(resolved.path).catch(() => null);
    if (!stat?.isDirectory()) {
      await ctx.reply("That path is not a directory.");
      return;
    }

    await sessions.reset(ctx.chat.id, resolved.path);
    await ctx.reply(`Project: <code>${escapeHtml(resolved.path)}</code>\nFresh session started.`, {
      parse_mode: "HTML",
    });
  });

  bot.command("ls", async (ctx) => {
    const { agent } = await sessions.get(ctx.chat.id);
    const arg = ctx.match.trim();
    const resolved = await resolveWithinRoot(arg || agent.cwd, agent.cwd, config.approvedDirectory);
    if (!resolved.ok) {
      await ctx.reply(pathProblemMessage(config, resolved.reason, "Path not found."), {
        parse_mode: "HTML",
      });
      return;
    }

    const entries = await fs.readdir(resolved.path, { withFileTypes: true }).catch(() => null);
    if (!entries) {
      await ctx.reply("Could not list that path.");
      return;
    }

    const lines = entries
      .filter((entry) => !entry.name.startsWith("."))
      .sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
      )
      .slice(0, MAX_LISTED_ENTRIES)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));

    const body = lines.length > 0 ? lines.join("\n") : "(empty)";
    await ctx.reply(`<code>${escapeHtml(resolved.path)}</code>\n<pre>${escapeHtml(body)}</pre>`, {
      parse_mode: "HTML",
    });
  });

  bot.command("projects", async (ctx) => {
    const entries = await fs
      .readdir(config.approvedDirectory, { withFileTypes: true })
      .catch(() => null);
    if (!entries) {
      await ctx.reply("Could not read APPROVED_DIRECTORY.");
      return;
    }

    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => `/cd ${path.join(config.approvedDirectory, entry.name)}`)
      .sort();

    if (dirs.length === 0) {
      await ctx.reply("No project directories found under APPROVED_DIRECTORY.");
      return;
    }
    await ctx.reply(`<pre>${escapeHtml(dirs.slice(0, 80).join("\n"))}</pre>`, {
      parse_mode: "HTML",
    });
  });

  bot.command("new", async (ctx) => {
    const { agent } = await sessions.reset(ctx.chat.id);
    await ctx.reply(`Fresh session in <code>${escapeHtml(agent.cwd)}</code>.`, {
      parse_mode: "HTML",
    });
  });

  bot.command("stop", async (ctx) => {
    const { agent } = await sessions.get(ctx.chat.id);
    if (!agent.busy) {
      await ctx.reply("Nothing is running.");
      return;
    }
    await agent.interrupt();
    await ctx.reply("Interrupted.");
  });

  bot.command("status", async (ctx) => {
    const { agent } = await sessions.get(ctx.chat.id);
    const subscription = agent.apiKeySource === "none";
    await ctx.reply(
      [
        `<b>project</b> <code>${escapeHtml(agent.cwd)}</code>`,
        `<b>session</b> <code>${escapeHtml(agent.sessionId ?? "(not started yet)")}</code>`,
        `<b>model</b> ${escapeHtml(agent.model || "(pending)")}`,
        `<b>auth</b> ${subscription ? "Claude subscription (no API key)" : `API key (${escapeHtml(agent.apiKeySource || "pending")})`}`,
        `<b>state</b> ${agent.busy ? "working" : "idle"}`,
        subscription
          ? `<b>usage</b> ~$${agent.totalCostUsd.toFixed(4)} at list prices (estimate, not billed)`
          : `<b>cost</b> $${agent.totalCostUsd.toFixed(4)}`,
      ].join("\n"),
      { parse_mode: "HTML" },
    );
  });

  bot.command("get", async (ctx) => {
    const arg = ctx.match.trim();
    if (!arg) {
      await ctx.reply("Usage: /get path/to/file");
      return;
    }

    const { agent } = await sessions.get(ctx.chat.id);
    const resolved = await resolveWithinRoot(arg, agent.cwd, config.approvedDirectory);
    if (!resolved.ok) {
      await ctx.reply(pathProblemMessage(config, resolved.reason, "File not found."), {
        parse_mode: "HTML",
      });
      return;
    }

    const problem = await describeUploadProblem(resolved.path);
    if (problem) {
      await ctx.reply(problem);
      return;
    }
    await ctx.replyWithDocument(new InputFile(resolved.path));
  });
}
