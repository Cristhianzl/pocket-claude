# Security Policy

## What this software is

PocketClaude gives a Telegram chat the ability to run Claude Code on the machine
hosting it, with `permissionMode: 'bypassPermissions'` — **every tool call,
including shell commands, executes without asking for confirmation.**

That is the intended design: confirming each step from a phone would make the
tool pointless. It also means the honest description of this project is *a
remote shell fronted by an LLM*. Treat it that way when you deploy it.

## Threat model

**Trusted:** the machine's operating system and user account, the Anthropic
Claude Code CLI and its stored credentials, and every Telegram user ID listed in
`ALLOWED_USERS`.

**Not trusted:** everyone else on Telegram, and the content of anything Claude
reads — files, web pages, tool output — which may attempt prompt injection.

**Controls in place:**

| Control | What it stops | What it does not stop |
|---|---|---|
| `ALLOWED_USERS` allowlist | Anyone who is not on the list from issuing commands. The bot refuses to start with an empty list. | Anyone who compromises a listed Telegram account. |
| Private-chats-only | Group members reading the output of your files and commands. | Nothing else; it is a confidentiality control. |
| `APPROVED_DIRECTORY` | `/cd`, `/ls` and `/get` from reaching outside the root, including via `..` and via symlinks that resolve outside it. | Claude's own `Bash` tool, which can reach anything your user account can. |

**`APPROVED_DIRECTORY` is not a sandbox.** It scopes the bot's own commands, not
the agent's capabilities. If you need real isolation, run PocketClaude as a
dedicated user account with narrow permissions, or inside a container or VM.

## Deploying responsibly

- Never add a user you do not fully trust to `ALLOWED_USERS`.
- Enable two-factor authentication on your Telegram account. Your account is the
  authentication boundary.
- Point `APPROVED_DIRECTORY` at your code, not at your home directory.
- Keep `.env` out of version control. It is git-ignored by default; do not put
  real values in `.env.example`, which is committed.
- Prefer a dedicated user account, container, or VM over your primary login.

## Supported versions

Security fixes are applied to the `main` branch. There are no long-term support
branches.

## Reporting a vulnerability

Please report security issues **privately**, not as a public GitHub issue.

Use GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository, or email the maintainer listed in `package.json`.

Please include a description of the issue, steps to reproduce, and the impact
you believe it has. You can expect an acknowledgement within a few days. There
is no bug bounty for this project.

## Out of scope

The following are documented design decisions rather than vulnerabilities:

- Claude executing commands without confirmation (`bypassPermissions`).
- `Bash` reaching outside `APPROVED_DIRECTORY`.
- `/id` answering before the allowlist check — it returns only the caller's own
  Telegram ID, and it is how a new operator discovers the value to configure.
