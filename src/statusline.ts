import { ANSI } from "./banner.js";
import { setLogSink } from "./logger.js";

export type Stats = {
  chats: number;
  turns: number;
  costUsd: number;
  busy: boolean;
  billedPerToken: boolean;
};

export type StatusLineOptions = {
  read: () => Stats;
  write?: (text: string) => void;
  columns?: () => number;
  now?: () => number;
  color?: boolean;
  intervalMs?: number;
};

const LINES = 3;

export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatStats(stats: Stats, uptimeMs: number): string {
  const cost = stats.billedPerToken
    ? `$${stats.costUsd.toFixed(2)}`
    : `~$${stats.costUsd.toFixed(2)}`;
  const chats = `${stats.chats} chat${stats.chats === 1 ? "" : "s"}`;
  const turns = `${stats.turns} turn${stats.turns === 1 ? "" : "s"}`;
  return `up ${formatUptime(uptimeMs)} │ ${chats} │ ${turns} │ ${cost} │ ${
    stats.busy ? "working" : "idle"
  }`;
}

/**
 * A footer pinned to the bottom of the terminal. It owns stdout while running —
 * log lines are erased around, then redrawn under, so they never tear the
 * footer. Only ever started on a TTY; a pipe or journald keeps plain logs.
 */
export class StatusLine {
  #read: StatusLineOptions["read"];
  #write: (text: string) => void;
  #columns: () => number;
  #now: () => number;
  #color: boolean;
  #intervalMs: number;
  #startedAt: number;
  #timer: NodeJS.Timeout | null = null;
  #drawn = false;

  constructor(options: StatusLineOptions) {
    this.#read = options.read;
    this.#write = options.write ?? ((text) => process.stdout.write(text));
    this.#columns = options.columns ?? (() => process.stdout.columns || 80);
    this.#now = options.now ?? (() => Date.now());
    this.#color = options.color ?? false;
    this.#intervalMs = options.intervalMs ?? 1000;
    this.#startedAt = this.#now();
  }

  start(): void {
    if (this.#timer) return;
    this.#write("\x1b[?25l");
    setLogSink((line) => {
      this.erase();
      this.#write(line);
      this.draw();
    });
    this.draw();
    this.#timer = setInterval(() => this.refresh(), this.#intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.erase();
    setLogSink();
    this.#write("\x1b[?25h");
  }

  refresh(): void {
    this.erase();
    this.draw();
  }

  erase(): void {
    if (!this.#drawn) return;
    this.#write(`\x1b[${LINES}A\x1b[0J`);
    this.#drawn = false;
  }

  draw(): void {
    const width = Math.max(20, Math.min(this.#columns(), 100));
    const rule = "─".repeat(width - 2);
    const body = ` ● ${formatStats(this.#read(), this.#now() - this.#startedAt)}`;
    const dim = (text: string) => (this.#color ? `${ANSI.dim}${text}${ANSI.reset}` : text);
    this.#write(`${dim(` ${rule}`)}\n${body}\n${dim(` ${rule}`)}\n`);
    this.#drawn = true;
  }
}
