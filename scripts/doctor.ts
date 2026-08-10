import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildConfig, ConfigError } from "../src/config.js";
import { isPlaceholder, REQUIRED_VARS, readEnvFile } from "../src/env.js";

type Level = "ok" | "warn" | "fail";
const results: Array<{ level: Level; message: string }> = [];
const ok = (message: string) => results.push({ level: "ok", message });
const warn = (message: string) => results.push({ level: "warn", message });
const fail = (message: string) => results.push({ level: "fail", message });

const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) ok(`Node.js ${process.versions.node}`);
else fail(`Node.js ${process.versions.node} — version 20 or newer is required`);

const envPath = path.resolve(".env");
if (!fs.existsSync(envPath)) {
  fail(".env not found — run 'make setup'");
} else {
  ok(".env found");

  // Validating through the bot's own loader means the doctor cannot pass on a
  // file the bot would reject.
  try {
    const config = buildConfig({ ...readEnvFile(envPath), ...process.env });
    ok(`ALLOWED_USERS: ${config.allowedUsers.size} user(s)`);

    const stat = fs.existsSync(config.approvedDirectory)
      ? fs.statSync(config.approvedDirectory)
      : null;
    if (stat?.isDirectory()) ok(`APPROVED_DIRECTORY: ${config.approvedDirectory}`);
    else fail(`APPROVED_DIRECTORY is not a directory: ${config.approvedDirectory}`);

    if (!/^\d+:[\w-]{20,}$/.test(config.botToken)) {
      warn("TELEGRAM_BOT_TOKEN does not look like a BotFather token (123456:ABC-...)");
    }
  } catch (error) {
    if (error instanceof ConfigError) fail(error.message);
    else throw error;
  }

  // Real credentials in the committed template would leak into Git history.
  const template = readEnvFile(path.resolve(".env.example"));
  for (const name of REQUIRED_VARS) {
    const value = template[name];
    if (value && !isPlaceholder(name, value)) {
      fail(`.env.example holds a real value for ${name} — move it to .env before committing`);
    }
  }
}

if (process.env.ANTHROPIC_API_KEY) {
  ok("ANTHROPIC_API_KEY is set (usage billed per token)");
} else if (fs.existsSync(path.join(os.homedir(), ".claude"))) {
  ok("~/.claude found — using your Claude Code subscription login");
} else {
  fail("No Claude credentials — run 'claude' once to log in, or set ANTHROPIC_API_KEY");
}

try {
  const version = execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  ok(`Claude Code CLI: ${version}`);
} catch {
  warn("Claude Code CLI not on PATH (optional — the SDK bundles its own)");
}

const icon: Record<Level, string> = { ok: "✓", warn: "!", fail: "✗" };
const color: Record<Level, string> = { ok: "\x1b[32m", warn: "\x1b[33m", fail: "\x1b[31m" };

process.stdout.write("\n");
for (const { level, message } of results) {
  process.stdout.write(`${color[level]}${icon[level]}\x1b[0m ${message}\n`);
}

const failures = results.filter((result) => result.level === "fail").length;
process.stdout.write("\n");
if (failures > 0) {
  process.stdout.write(`\x1b[31m${failures} problem(s) to fix before running.\x1b[0m\n`);
  process.exit(1);
}
process.stdout.write("\x1b[32mAll good — run 'make run'.\x1b[0m\n");
