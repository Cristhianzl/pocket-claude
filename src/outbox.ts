import type { Bot } from "grammy";
import { log } from "./logger.js";
import { escapeHtml, markdownToTelegramHtml, splitForTelegram, stripHtml } from "./render.js";

const MIN_EDIT_INTERVAL_MS = 1200;
const SEND_SPACING_MS = 250;
const MAX_STATUS_LINES = 12;
const TELEGRAM_MAX = 4096;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serializes all output for one chat. Two things depend on this: message order
 * (an activity line before the prose it produced) and Telegram's rate limits,
 * which are per chat.
 */
export class Outbox {
  #bot: Bot;
  #chatId: number;
  #chain: Promise<void> = Promise.resolve();

  #statusMessageId: number | null = null;
  #statusLines: string[] = [];
  #statusText = "";
  #queuedActivities = 0;
  #lastEditAt = 0;

  constructor(bot: Bot, chatId: number) {
    this.#bot = bot;
    this.#chatId = chatId;
  }

  /**
   * Appends a line to the live status card.
   *
   * The append happens inside the queue, not at call time: mutating the shared
   * buffer outside it let an activity that occurred *after* some prose be
   * rendered into the status card sent *before* that prose.
   */
  activity(line: string): void {
    this.#queuedActivities += 1;
    this.#enqueue(async () => {
      this.#queuedActivities -= 1;
      this.#statusLines.push(line);
      if (this.#statusLines.length > MAX_STATUS_LINES) {
        this.#statusLines = this.#statusLines.slice(-MAX_STATUS_LINES);
      }

      // Coalesce bursts: only the last queued activity renders.
      if (this.#queuedActivities > 0) return;
      // Throttled edits are not lost — markdown(), notice() and drain() all
      // flush the status before doing anything else.
      if (Date.now() - this.#lastEditAt < MIN_EDIT_INTERVAL_MS) return;
      await this.#renderStatus();
    });
  }

  /** Sends assistant prose and closes the current status card. */
  markdown(text: string): void {
    this.#enqueue(async () => {
      await this.#renderStatus();
      this.#sealStatus();
      const html = markdownToTelegramHtml(text);
      if (!html) return;
      for (const chunk of splitForTelegram(html)) {
        await this.#send(chunk);
        await sleep(SEND_SPACING_MS);
      }
    });
  }

  /** Sends a short note from the bot itself (already HTML). */
  notice(html: string): void {
    this.#enqueue(async () => {
      await this.#renderStatus();
      this.#sealStatus();
      await this.#send(html);
    });
  }

  /** Flushes any throttled status update, then waits for the queue to empty. */
  drain(): Promise<void> {
    this.#enqueue(() => this.#renderStatus());
    return this.#chain;
  }

  #enqueue(task: () => Promise<void>): void {
    this.#chain = this.#chain.then(task).catch((error: unknown) => {
      log.error("outbox task failed", { chat_id: this.#chatId, error: String(error) });
    });
  }

  #sealStatus(): void {
    this.#statusMessageId = null;
    this.#statusLines = [];
    this.#statusText = "";
  }

  async #renderStatus(): Promise<void> {
    if (this.#statusLines.length === 0) return;
    const body = this.#statusLines.map((line) => `· ${escapeHtml(line)}`).join("\n");
    const text = `<i>working</i>\n<pre>${body}</pre>`;
    if (text === this.#statusText) return;

    try {
      if (this.#statusMessageId === null) {
        const sent = await this.#bot.api.sendMessage(this.#chatId, text, { parse_mode: "HTML" });
        this.#statusMessageId = sent.message_id;
      } else {
        await this.#bot.api.editMessageText(this.#chatId, this.#statusMessageId, text, {
          parse_mode: "HTML",
        });
      }
      this.#statusText = text;
      this.#lastEditAt = Date.now();
    } catch (error) {
      // "message is not modified" is expected; nothing here should be able to
      // take down the output pipeline.
      if (!String(error).includes("message is not modified")) {
        log.error("status update failed", { chat_id: this.#chatId, error: String(error) });
      }
    }
  }

  async #send(html: string): Promise<void> {
    try {
      await this.#bot.api.sendMessage(this.#chatId, html, { parse_mode: "HTML" });
    } catch (error) {
      // If the generated HTML is rejected, resend as plain text rather than
      // dropping Claude's answer.
      log.warn("HTML send rejected, retrying as plain text", {
        chat_id: this.#chatId,
        error: String(error),
      });
      await this.#bot.api
        .sendMessage(this.#chatId, stripHtml(html).slice(0, TELEGRAM_MAX))
        .catch((inner: unknown) => {
          log.error("plain-text fallback failed", {
            chat_id: this.#chatId,
            error: String(inner),
          });
        });
    }
  }
}
