type Level = "info" | "warn" | "error";

const STREAM: Record<Level, NodeJS.WriteStream> = {
  info: process.stdout,
  warn: process.stderr,
  error: process.stderr,
};

/**
 * Minimal structured logger. A daemon's stdout is its operational interface, so
 * output goes through here rather than bare `console.*` calls: one place to
 * change the format, and one place that knows never to log message bodies.
 */
function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const detail = fields
    ? " " +
      Object.entries(fields)
        .map(
          ([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
        )
        .join(" ")
    : "";
  STREAM[level].write(`${timestamp} ${level.toUpperCase()} ${message}${detail}\n`);
}

export const log = {
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};
