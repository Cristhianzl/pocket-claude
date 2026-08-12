export type BannerInfo = {
  version: string;
  bot: string;
  model: string;
  root: string;
  users: number;
  skills: number;
  commands: number;
  chats: number;
};

const WORDMARK = [
  "██████╗  ██████╗  ██████╗██╗  ██╗███████╗████████╗",
  "██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██╔════╝╚══██╔══╝",
  "██████╔╝██║   ██║██║     █████╔╝ █████╗     ██║",
  "██╔═══╝ ██║   ██║██║     ██╔═██╗ ██╔══╝     ██║",
  "██║     ╚██████╔╝╚██████╗██║  ██╗███████╗   ██║",
  "╚═╝      ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝   ╚═╝",
];

const PANEL_WIDTH = 49;

export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
} as const;

/** Width in terminal cells: the wordmark and box glyphs are all single-width. */
function visibleLength(text: string): number {
  return [...text].length;
}

function paint(text: string, code: string, color: boolean): string {
  return color ? `${code}${text}${ANSI.reset}` : text;
}

function row(label: string, value: string, color: boolean): string {
  const content = `  ${label.padEnd(13)}${value}`;
  const filler = " ".repeat(Math.max(0, PANEL_WIDTH - 2 - visibleLength(content)));
  return `  │  ${paint(label.padEnd(13), ANSI.dim, color)}${value}${filler}│`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function renderBanner(info: BannerInfo, options: { color?: boolean } = {}): string {
  const color = options.color ?? false;
  const edge = "─".repeat(PANEL_WIDTH - 2);
  const lines = [
    "",
    ...WORDMARK.map((line) => `  ${paint(line, ANSI.cyan + ANSI.bold, color)}`),
    `         ${paint("c l a u d e", ANSI.cyan, color)}   ${paint(`·   v${info.version}`, ANSI.dim, color)}`,
    "",
    `  ┌${edge}┐`,
    row("bot", info.bot, color),
    row("model", info.model, color),
    row("root", info.root, color),
    row("users", plural(info.users, "allowed user"), color),
    row("skills", `${info.skills} bundled · ${info.commands} commands`, color),
    row("chats", plural(info.chats, "saved session"), color),
    `  └${edge}┘`,
    "",
    `  ${paint("⚠", ANSI.yellow, color)}  bypassPermissions — Claude executes without asking`,
    `  ${paint("●", ANSI.green, color)}  listening · Ctrl+C to stop`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}
