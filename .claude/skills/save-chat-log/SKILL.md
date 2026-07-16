---
name: save-chat-log
description: Save the current Claude Code chat transcript for this repository into the chat_logs/ folder as a readable Markdown file. Use when the user asks to save, export, archive, or dump the current conversation / chat history. Works for any user of this repo — it auto-detects the live session and needs no hardcoded paths or IDs.
---

# Save chat log

Export the **current session's** conversation to `chat_logs/<date>_<sessionId>.md`.

The bundled script derives the transcript location from the current working
directory and the Claude config dir, so every developer using this repository
gets their own log without editing anything.

## Run

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/export_chat.py"
```

On Windows (PowerShell), if `${CLAUDE_SKILL_DIR}` is not set, use the repo path:

```powershell
python .claude/skills/save-chat-log/scripts/export_chat.py
```

Run it from the repository root so `chat_logs/` lands next to the source.

## How it finds the transcript

Resolution order:

1. `--session <id>` — an explicit session id, if the user names one.
2. `$CLAUDE_SESSION_ID` — the env var Claude Code sets for the live session.
3. Newest `*.jsonl` — the most recently modified transcript for this repo,
   under `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<encoded-cwd>/`.

The project directory name is the working directory with every non-alphanumeric
character replaced by `-` (matching Claude Code's own encoding).

## Options

- `--out-dir <dir>` — output folder (default `chat_logs`).
- `--thinking` — include assistant thinking blocks (default: omitted).
- `--tool-results` — include truncated tool results (default: omitted).

By default the log keeps only human messages, assistant replies, and a compact
one-line note per tool call, so it reads cleanly.

## Notes

- Re-running for the same session overwrites its file, so the log stays current.
- The transcript is cumulative; the most recent turns may not be flushed to disk
  until the current turn completes, so run this after the exchange you want saved.
- Consider whether `chat_logs/` should be committed or git-ignored for this repo;
  logs can contain code, paths, and discussion from the session.
