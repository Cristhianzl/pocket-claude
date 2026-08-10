const TELEGRAM_MAX = 4096;
const CHUNK_TARGET = 3500;

export function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts the subset of Markdown that Claude actually emits into the HTML
 * subset Telegram accepts. Deliberately conservative: anything that does not
 * match is escaped, so this never produces invalid markup.
 */
export function markdownToTelegramHtml(input: string): string {
  const fence = /```([\w+-]*)\n?([\s\S]*?)```/g;
  let result = "";
  let cursor = 0;

  for (let match = fence.exec(input); match; match = fence.exec(input)) {
    result += inlineToHtml(input.slice(cursor, match.index));
    result += `<pre><code>${escapeHtml(match[2] ?? "")}</code></pre>`;
    cursor = match.index + match[0].length;
  }
  result += inlineToHtml(input.slice(cursor));
  return result.trim();
}

function inlineToHtml(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, (_m, bold: string) => `<b>${bold}</b>`);
  out = out.replace(/^#{1,6}\s+(.+)$/gm, (_m, title: string) => `<b>${title}</b>`);
  return out;
}

/**
 * Splits text into Telegram-sized messages, preferring line breaks and never
 * cutting a `<pre>` block open.
 */
export function splitForTelegram(html: string): string[] {
  if (html.length <= TELEGRAM_MAX) return [html];

  const chunks: string[] = [];
  let rest = html;

  while (rest.length > TELEGRAM_MAX) {
    // Prefer a line break, but only when it is far enough along — otherwise an
    // early newline would emit a near-empty message.
    const newline = rest.lastIndexOf("\n", CHUNK_TARGET);
    const cut = newline > CHUNK_TARGET / 2 ? newline : CHUNK_TARGET;

    let head = rest.slice(0, cut);
    let tail = rest.slice(cut);

    // If the cut landed inside a code block, close and reopen the tags.
    const opens = (head.match(/<pre><code>/g) ?? []).length;
    const closes = (head.match(/<\/code><\/pre>/g) ?? []).length;
    if (opens > closes) {
      head += "</code></pre>";
      tail = `<pre><code>${tail}`;
    }

    chunks.push(head);
    rest = tail;
  }

  if (rest.trim()) chunks.push(rest);
  return chunks;
}

/**
 * Reverses `markdownToTelegramHtml` well enough for the plain-text fallback.
 * Entities must be decoded too, or a rejected message resends showing literal
 * `&lt;` to the user.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function shorten(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}...` : oneLine;
}

/** Reduces a tool call to a single line that reads well on a phone. */
export function describeToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash":
      return `$ ${shorten(input.command)}`;
    case "Read":
      return `read ${shorten(input.file_path, 80)}`;
    case "Write":
      return `write ${shorten(input.file_path, 80)}`;
    case "Edit":
      return `edit ${shorten(input.file_path, 80)}`;
    case "NotebookEdit":
      return `notebook ${shorten(input.notebook_path, 80)}`;
    case "Glob":
      return `glob ${shorten(input.pattern, 80)}`;
    case "Grep":
      return `grep ${shorten(input.pattern, 80)}`;
    case "WebFetch":
      return `fetch ${shorten(input.url, 80)}`;
    case "WebSearch":
      return `search ${shorten(input.query, 80)}`;
    case "Task":
    case "Agent":
      return `subagent: ${shorten(input.description ?? input.prompt, 80)}`;
    case "TodoWrite":
      return "updating plan";
    default: {
      const detail = shorten(input, 80);
      return detail && detail !== "{}" ? `${name} ${detail}` : name;
    }
  }
}
