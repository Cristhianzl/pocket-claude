import path from "node:path";
import { isPlaceholder, readEnvFile } from "./env.js";
import { resolveHome } from "./paths.js";

export type Config = {
  botToken: string;
  botUsername: string;
  allowedUsers: ReadonlySet<number>;
  /**
   * Root directory the bot may work in. `/cd` cannot escape it, so a
   * compromised chat cannot walk the agent out to `~/.ssh`.
   */
  approvedDirectory: string;
  model: string | undefined;
  stateFile: string;
};

export class ConfigError extends Error {}

type Source = Record<string, string | undefined>;

function read(source: Source, name: string): string | undefined {
  return source[name]?.trim() || undefined;
}

function required(source: Source, name: string): string {
  const value = read(source, name);
  if (!value) {
    throw new ConfigError(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  }
  if (isPlaceholder(name, value)) {
    throw new ConfigError(`${name} is still the template value — edit .env, not .env.example.`);
  }
  return value;
}

/**
 * The bot runs Claude with `permissionMode: 'bypassPermissions'`, so every tool
 * call executes without confirmation. The user allowlist is the only thing
 * standing between Telegram and a shell on this machine — it is mandatory.
 */
function parseAllowedUsers(raw: string): Set<number> {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (!/^\d+$/.test(part)) {
        throw new ConfigError(`ALLOWED_USERS contains a non-numeric entry: "${part}"`);
      }
      return Number(part);
    });

  if (ids.length === 0) {
    throw new ConfigError("ALLOWED_USERS is empty. Add at least one Telegram user ID.");
  }
  return new Set(ids);
}

/**
 * Builds the configuration from an explicit source. Taking the environment as a
 * parameter — rather than reading `process.env` at import time — keeps every
 * importer of this module loadable without a populated environment.
 */
export function buildConfig(source: Source): Config {
  return {
    botToken: required(source, "TELEGRAM_BOT_TOKEN"),
    botUsername: required(source, "TELEGRAM_BOT_USERNAME").replace(/^@/, ""),
    allowedUsers: parseAllowedUsers(required(source, "ALLOWED_USERS")),
    approvedDirectory: resolveHome(required(source, "APPROVED_DIRECTORY")),
    model: read(source, "CLAUDE_MODEL"),
    stateFile: resolveHome(read(source, "STATE_FILE") ?? path.join(".", "data", "state.json")),
  };
}

/** Loads `.env` and merges it under the real environment, which wins. */
export function loadConfig(envFile = ".env", processEnv: Source = process.env): Config {
  return buildConfig({ ...readEnvFile(envFile), ...processEnv });
}
