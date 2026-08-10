export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function parseLevel(raw: string | undefined): LogLevel {
  return raw && raw in RANK ? (raw as LogLevel) : "info";
}

let threshold: LogLevel = parseLevel(process.env.LOG_LEVEL);

/** Lets tests silence output, and operators raise or lower verbosity. */
export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

export function getLogLevel(): LogLevel {
  return threshold;
}

export type LogSink = (line: string) => void;

const DEFAULT_SINKS: Record<Exclude<LogLevel, "silent">, LogSink> = {
  debug: (line) => process.stdout.write(line),
  info: (line) => process.stdout.write(line),
  warn: (line) => process.stderr.write(line),
  error: (line) => process.stderr.write(line),
};

let sinks = DEFAULT_SINKS;

/** Redirects output; passing nothing restores stdout/stderr. */
export function setLogSink(sink?: LogSink): void {
  sinks = sink ? { debug: sink, info: sink, warn: sink, error: sink } : DEFAULT_SINKS;
}

export function formatLine(
  level: Exclude<LogLevel, "silent">,
  timestamp: string,
  message: string,
  fields?: Record<string, unknown>,
): string {
  const detail = fields
    ? ` ${Object.entries(fields)
        .map(
          ([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
        )
        .join(" ")}`
    : "";
  return `${timestamp} ${level.toUpperCase()} ${message}${detail}\n`;
}

/**
 * Minimal structured logger. A daemon's stdout is its operational interface, so
 * output goes through here rather than bare `console.*` calls: one place to
 * change the format, and one place that knows never to log message bodies.
 */
function emit(
  level: Exclude<LogLevel, "silent">,
  message: string,
  fields?: Record<string, unknown>,
): void {
  if (RANK[level] < RANK[threshold]) return;
  sinks[level](formatLine(level, new Date().toISOString(), message, fields));
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => emit("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};
