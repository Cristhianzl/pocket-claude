import fs from "node:fs";
import dotenv from "dotenv";

export const REQUIRED_VARS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "APPROVED_DIRECTORY",
  "ALLOWED_USERS",
] as const;

/**
 * Placeholders are syntactically valid, so an unedited .env passes every format
 * check and then fails with a confusing 401 from Telegram. Kept here rather than
 * read from .env.example, which the user may have edited.
 */
export const PLACEHOLDERS: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  TELEGRAM_BOT_USERNAME: "my_claude_bot",
  APPROVED_DIRECTORY: "/Users/yourname/projects",
  ALLOWED_USERS: "123456789",
};

/**
 * Single parser for .env files, shared by the bot and by `make doctor`. Two
 * implementations would let the doctor pass on a file the bot cannot load.
 */
export function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  return dotenv.parse(fs.readFileSync(file, "utf8"));
}

export function isPlaceholder(name: string, value: string): boolean {
  return PLACEHOLDERS[name] === value;
}
