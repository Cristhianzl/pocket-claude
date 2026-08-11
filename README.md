# PocketClaude

Run **Claude Code** on your own machine and drive it from **Telegram**.

Leave your computer on at home, and work from your phone: send a prompt, watch
the tool calls stream back, get the answer. Each Telegram chat keeps its own
project directory and its own Claude session, which survive bot restarts.

```
You  ▸ add a health check endpoint to the API
Bot  ▸ working
       · read src/server.ts
       · edit src/server.ts
       · $ npm test
     ▸ Added GET /health returning { status, uptime }. Tests pass.
     ▸ done · 24.1s · $0.0412
```

> An independent community project. Not affiliated with, endorsed by, or
> supported by Anthropic.

---

## Requirements

- **Node.js 20+** (`node --version`)
- **Linux or macOS.** Windows is not supported; use WSL2. `make service` is
  Linux/systemd only — on macOS run `make run` inside `tmux` or use `launchd`.
- **A Claude Code login** — run `claude` once in a terminal and sign in, or
  export `ANTHROPIC_API_KEY`
- **A Telegram bot token** — see step 1 below

---

## Setup

### 1. Create a Telegram bot

Open [@BotFather](https://t.me/BotFather) in Telegram and send:

```
/newbot
```

Pick a display name and a username ending in `bot`. BotFather replies with a
token that looks like `1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`. Keep it —
anyone holding it controls your bot.

### 2. Install

```bash
git clone https://github.com/Cristhianzl/pocket-claude
cd pocket-claude
make setup
```

`make setup` installs dependencies and creates `.env` from the template.

### 3. Configure

Open `.env` and fill in the four required values:

```env
TELEGRAM_BOT_TOKEN=1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_BOT_USERNAME=my_claude_bot
APPROVED_DIRECTORY=/Users/yourname/projects
ALLOWED_USERS=123456789
```

| Variable | What it is |
|---|---|
| `TELEGRAM_BOT_TOKEN` | The token from BotFather. |
| `TELEGRAM_BOT_USERNAME` | Your bot's handle, without the `@`. |
| `APPROVED_DIRECTORY` | Root directory the bot may work in. `/cd` cannot escape it. |
| `ALLOWED_USERS` | Comma-separated Telegram user IDs allowed to use the bot. |

> **`APPROVED_DIRECTORY` must be a path that actually exists on this machine.**
> The value in the template is a macOS example — the bot refuses to start if the
> directory is missing.

#### Finding your Telegram user ID

`ALLOWED_USERS` needs a numeric ID, not your `@handle`. Two ways to get it:

**A. Ask another bot (nothing to run).** Message
[@userinfobot](https://t.me/userinfobot) on Telegram and it replies with your ID.

**B. Ask your own bot.** `/id` is the one command that works *before* you are
allowlisted, precisely to solve this chicken-and-egg:

1. Fill in the real token and a valid `APPROVED_DIRECTORY`. Leave
   `ALLOWED_USERS=1` as a placeholder — it just has to be non-empty.
2. `make run`
3. In Telegram, open your bot (search for the username you gave BotFather) and
   send `/id`. It replies with your user ID.
4. Stop the bot (`Ctrl+C`), put that number in `ALLOWED_USERS`, and run again.

`/start` will *not* work at step 3 — it sits behind the allowlist. Only `/id`
gets through.

Optional:

| Variable | Default | What it does |
|---|---|---|
| `CLAUDE_MODEL` | Claude Code's default | Pins a specific model. |
| `STATE_FILE` | `./data/state.json` | Where chat → project/session mapping lives. |

### 4. Verify and run

```bash
make doctor   # checks Node, .env, credentials, directories
make run
```

Message your bot on Telegram. Send `/start` for the command list.

---

## Keeping it running

`make run` stops when you close the terminal. To keep the bot alive across
reboots (Linux, systemd):

```bash
make service                    # install, enable and start a user service
loginctl enable-linger $USER    # keep it running when you're logged out
make logs                       # follow the output
```

Other service targets: `make service-status`, `make service-restart`,
`make service-stop`, `make service-uninstall`.

On macOS, use `launchd` or simply run `make run` inside `tmux`/`screen`.

---

## Usage

Any plain text you send becomes a prompt for Claude in the chat's current
project. Messages sent while Claude is working are queued, not dropped.

### Commands

| Command | What it does |
|---|---|
| `/start`, `/help` | Show the command list. |
| `/pwd` | Current project directory. |
| `/cd <path>` | Switch project. Starts a fresh session. Confined to `APPROVED_DIRECTORY`. |
| `/ls [path]` | List a directory. |
| `/projects` | List project directories, each as a ready-to-tap `/cd` command. |
| `/new` | Drop the conversation context and start over in the same directory. |
| `/stop` | Interrupt whatever Claude is doing right now. |
| `/status` | Session ID, model, state and accumulated cost. |
| `/get <path>` | Download a file from the machine (up to 45 MB). |
| `/id` | Show your Telegram user ID. Works before you are allowlisted. |

### How output is rendered

- **Tool calls** collapse into one live "working" card that updates in place, so
  a long run does not flood the chat.
- **Claude's prose** arrives as normal messages, with code blocks preserved and
  long answers split across messages.
- **Each turn ends** with a one-line footer: duration and cost.

### Authentication and cost

The bot uses whatever credentials Claude Code already has on this machine. Two
cases, and `/status` tells you which one you are in:

- **Claude subscription** (you ran `claude` and logged in). No API key is
  involved and nothing is billed per token — you consume your plan's usage
  limits. The figure in the footer is marked `~$… est.`: it is what those tokens
  *would* cost at API list prices, useful as a relative signal only.
- **API key** (`ANTHROPIC_API_KEY` is set). Usage is billed per token and the
  footer shows the real estimated charge.

Either way, expect a fixed overhead per turn: every request carries Claude
Code's system prompt and tool definitions (a few thousand tokens), so even
"hello" reports a non-trivial number. Prompt caching brings this down over the
course of a session.

### Sessions

One Claude session per Telegram chat. The session ID and project directory are
persisted to `STATE_FILE`, so restarting the bot resumes exactly where you left
off. `/cd` and `/new` start a fresh session; everything else continues the
existing one.

To work on several projects at once, open a second Telegram chat with the bot
from another allowlisted account, or switch with `/cd` — each chat keeps its own
independent session.

---

## Security

This bot runs Claude with `permissionMode: 'bypassPermissions'`. **Claude
executes every tool call — including `Bash` — without asking for confirmation.**
That is deliberate: confirming each step from a phone defeats the purpose. It
also means the bot is exactly as trusted as your Telegram account.

Three barriers exist:

1. **`ALLOWED_USERS`** — every update from an unlisted user is rejected and
   logged. The bot refuses to start if this is empty.
2. **Private chats only** — the bot refuses to answer in groups and channels.
   The allowlist controls who may *send* commands, not who may *read* the
   replies; in a group, every member would see the files Claude prints.
3. **`APPROVED_DIRECTORY`** — `/cd`, `/ls` and `/get` resolve paths and reject
   anything outside this root, including via `..` and via symlinks that resolve
   outside it.

`APPROVED_DIRECTORY` is not a sandbox. Claude's own `Bash` tool can still reach
anywhere your user account can. Treat this as *your* shell exposed over
Telegram, and act accordingly:

- Never add users you do not fully trust to `ALLOWED_USERS`.
- Enable two-factor authentication on your Telegram account.
- Point `APPROVED_DIRECTORY` at your code, not at your home directory.
- Consider running it as a dedicated user account with narrower permissions.

The full threat model, and how to report a vulnerability, is in
[SECURITY.md](SECURITY.md).

---

## Make targets

| Target | What it does |
|---|---|
| `make setup` | Install dependencies and create `.env`. |
| `make doctor` | Check prerequisites and configuration. |
| `make run` | Start the bot. |
| `make dev` | Start with auto-reload on file changes. |
| `make test` | Run the test suite. |
| `make coverage` | Run the tests with a coverage report. |
| `make check` | Type-check the project. |
| `make verify` | Definition of done: types + tests + configuration. |
| `make reset` | Forget every chat's project/session mapping. |
| `make clean` | Remove `node_modules` and stored state. |
| `make lint` | Check formatting and lint rules. |
| `make format` | Apply formatting and safe lint fixes. |
| `make service` | Install and start the systemd user service. |
| `make logs` | Follow service logs. |

Run `make` with no arguments for the full list.

---

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
CI runs `make ci` (types, lint, tests) on Node 20, 22 and 24.

## Tests

`make test` runs the suite on Node's built-in test runner — no test framework
dependency. `make coverage` adds a branch-coverage report.

183 tests cover every module: the access gate, path confinement, configuration
and `.env` validation, Markdown → Telegram HTML, message splitting, the agent
loop, session lifecycle and recovery, the command handlers, the outbox ordering
and fallback rules, and the state store. Branch coverage sits around 89%.

The Claude SDK and the Telegram API are injected rather than mocked globally, so
the tests drive the real code paths: `ChatAgent` takes a `queryFn`,
`SessionManager` takes an agent factory, and the command modules are registered
onto a recording bot.

`src/index.ts` — the entry point that loads configuration and starts polling —
has no automated test; it is exercised by `make doctor` and by running the bot.

---

## How it works

```
Telegram ──▸ grammY ──▸ SessionManager ──▸ ChatAgent ──▸ Claude Agent SDK ──▸ your files
                            │                  │
                     one per chat        streaming-input query(),
                     persisted state     permissionMode=bypassPermissions
```

| File | Responsibility |
|---|---|
| `src/index.ts` | Bot wiring, commands, authentication, path confinement. |
| `src/sessions.ts` | One live agent per chat; creation, reset, disposal. |
| `src/agent.ts` | Wraps a long-lived streaming `query()`; turns SDK messages into events; loads the bundled config. |
| `src/outbox.ts` | Serializes and rate-limits everything sent to a chat. |
| `src/render.ts` | Markdown → Telegram HTML, message splitting, tool-call summaries. |
| `src/store.ts` | Persists chat → project/session mapping. |
| `src/config.ts` | Environment loading, validation, directory confinement. |

The agent uses the SDK's **streaming-input mode** — one long-lived `query()` per
chat rather than one per message. That is what makes message queueing and
`/stop` (via `interrupt()`) work.

### The bundled config

Claude normally reads `CLAUDE.md`, skills and slash commands from the directory
it is working in, so what a chat gets would depend on where `/cd` points. This
repository's own `.claude/` travels with the bot instead: it is loaded as a
local plugin, and its `CLAUDE.md` is appended to Claude Code's system prompt.
Every chat gets the same skills and instructions in every project.

The path is resolved from `src/agent.ts` itself, never from the working
directory. A project's own `.claude/` still loads on top, so per-project
conventions keep working.

Edit `.claude/` to change what every session gets. The `hooks` in
`.claude/settings.json` are deliberately left out — they apply when you open
*this* repository in Claude Code, not to the bot's sessions in other projects.

---

## Troubleshooting

**"Not authorized"** — your user ID is not in `ALLOWED_USERS`. Send `/id`, add
the number, restart.

**Bot does not respond at all** — run `make doctor`. Most often the token is
wrong or `APPROVED_DIRECTORY` does not exist.

**"No Claude credentials"** — run `claude` in a terminal and sign in, or export
`ANTHROPIC_API_KEY`.

**Session did not resume after restart** — check that `data/state.json` exists
and is writable. `make reset` clears it if it got into a bad state.

---

## License

[MIT](LICENSE) — do whatever you like, keep the copyright notice, no warranty.
# pocket-claude
