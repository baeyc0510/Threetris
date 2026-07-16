---
name: save-chat-log
description: Save the current Codex chat transcript (rollout) for this repository into the chat_logs/ folder as a readable Markdown file. Use when the user asks to save, export, archive, or dump the current conversation / chat history. Works for any user of this repo — it finds the session whose working directory matches this repo, with no hardcoded paths or IDs.
---

# Save chat log (Codex)

Export the **current session's** conversation to
`chat_logs/<date>_codex_<sessionId>.md`.

The bundled script locates the Codex rollout whose recorded working directory
matches the current repo, so every developer using this repository gets their
own log without editing anything.

## Run

Resolve the script relative to this `SKILL.md` (Agent Skills clients expose its
directory). From the repository root:

```bash
python3 .ai/skills/save-chat-log/scripts/export_chat.py
```

On Windows (PowerShell):

```powershell
python .ai/skills/save-chat-log/scripts/export_chat.py
```

If this repo also mirrors skills under `.agents/skills/`, the identical script
lives there too — either path works.

## How it finds the transcript

Codex stores sessions under
`${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`. Unlike
Claude Code, these are grouped by date, not by project path, so the script reads
each rollout's `session_meta.cwd` and picks the newest one matching the current
directory.

Selection order:

1. `--session <id>` — an explicit rollout/session id, if the user names one.
2. Newest rollout whose `cwd` equals the current working directory.
3. Newest rollout overall (with a warning) if none match.

## Options

- `--out-dir <dir>` — output folder (default `chat_logs`).
- `--reasoning` — include reasoning summaries when present (encrypted reasoning
  is always skipped; only plaintext summaries can be shown).
- `--tool-results` — include truncated tool/command outputs.

By default the log keeps human messages, assistant replies, and a compact
one-line note per tool call (`shell_command`, `apply_patch`, …).

The exporter also removes `AGENTS.md instructions` blocks before writing user
messages, so repository instructions do not appear as chat content.
When a Codex IDE context wrapper contains `## My request for Codex:`, the
exporter keeps only that request body instead of dropping the whole user turn.

## Notes

- Run this from the repository root so `chat_logs/` lands next to the source.
- Re-running for the same session overwrites its file, so the log stays current.
- The rollout is written as the session progresses; run this after the exchange
  you want saved so the latest turns are on disk.
- The Markdown format matches the Claude Code `save-chat-log` skill, so logs from
  both agents sit side by side in `chat_logs/` (Codex files carry a `codex_`
  marker in the name).
- Consider whether `chat_logs/` should be committed or git-ignored; logs can
  contain code, paths, and discussion from the session.
