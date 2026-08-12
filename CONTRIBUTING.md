# Contributing

Thanks for considering a contribution. This is a small project — the bar is
that changes are tested and that the security posture never gets looser by
accident.

## Getting set up

```bash
git clone https://github.com/Cristhianzl/pocket-claude
cd pocket-claude
make setup     # installs dependencies and creates .env
make doctor    # tells you exactly what is still missing
```

You need Node.js 20 or newer and a Claude Code login (`claude` in a terminal),
or an `ANTHROPIC_API_KEY`.

## Before opening a pull request

```bash
make verify    # types, lint, tests, and configuration
```

CI runs the same gates on Node 20, 22 and 24, minus the `.env` check.

## What a change needs

- **A test.** Every bug fix starts with a test that fails before the fix. Every
  new behavior gets one covering the success and the failure path. Test names
  follow `should_X_when_Y`.
- **English.** Code, comments, commit messages, and documentation, regardless of
  the language of the discussion.
- **Comments that say why, not what.** If a line needs a comment to explain what
  it does, rename something instead. Comments earn their place by recording a
  reason that is not visible in the code.
- **Conventional commits.** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`,
  `chore:`. Subject in the imperative, under 50 characters, no trailing period.

## Changes that touch security

Anything affecting `src/access.ts`, `src/paths.ts`, or the permission mode needs
extra care:

- Say in the PR description what an attacker could do before and after.
- Add a test that fails against the old behavior. `test/paths.test.ts` and
  `test/access.test.ts` show the shape — each control has a test named after the
  attack it blocks.
- Do not widen `APPROVED_DIRECTORY` handling or the allowlist without saying why
  in the description.

If you believe you have found a vulnerability, do not open a public issue — see
[SECURITY.md](SECURITY.md).

## Project layout

| Path | Responsibility |
|---|---|
| `src/index.ts` | Bot wiring, access gate, startup and shutdown. |
| `src/commands.ts` | Telegram command handlers. |
| `src/access.ts` | Who may talk to the bot, and from where. |
| `src/paths.ts` | Path resolution confined to the approved root. |
| `src/sessions.ts` | One live agent per chat: creation, reset, recovery. |
| `src/agent.ts` | Wraps a long-lived streaming `query()` into events; loads `.claude/` into every session. |
| `src/outbox.ts` | Serializes and rate-limits everything sent to a chat. |
| `src/render.ts` | Markdown to Telegram HTML, splitting, tool summaries. |
| `src/store.ts` | Persists the chat to project/session mapping. |
| `src/config.ts`, `src/env.ts` | Configuration loading and validation. |
| `src/banner.ts`, `src/statusline.ts` | Terminal banner and live status footer. |

Keep files under 500 lines and one responsibility each. If a file starts needing
"and" to describe it, split it.
