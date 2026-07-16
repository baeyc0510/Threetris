---
name: workspace-coordination
description: Coordinate parallel agents and developers through a shared WORKSPACE_STATUS.md. Use when starting, reviewing, progressing, blocking, completing, or handing off work in a repository where multiple Codex, Claude Code, other agents, or humans may operate. Do not use for private scratch notes, secrets, full transcripts, or hidden reasoning.
---

# Workspace coordination

Keep every participant synchronized through one repository-level `WORKSPACE_STATUS.md`.

Use the bundled script instead of manually rewriting managed sections.

## Resolve the script

When installed with the included installer, the canonical script is:

```bash
python3 .ai/skills/workspace-coordination/scripts/workspace_status.py
```

In Claude Code, this equivalent path is also available:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/workspace_status.py"
```

For Codex or another Agent Skills client, resolve `scripts/workspace_status.py` relative to this `SKILL.md` if the canonical project path is unavailable.

The status file defaults to the Git repository root. Override it with either:

```bash
export WORKSPACE_STATUS_FILE=/shared/path/WORKSPACE_STATUS.md
```

or the script's `--file` option.

## Required behavior

### At the beginning of work

1. Pick a stable agent identifier for this session, such as `codex-main`, `claude-ui`, or `human-alice`.
2. Initialize the status file if needed.
3. Read the current status before editing project files.
4. Register or claim the task before making substantial changes.

```bash
SCRIPT=.ai/skills/workspace-coordination/scripts/workspace_status.py

python3 "$SCRIPT" init
python3 "$SCRIPT" show
python3 "$SCRIPT" --agent "codex-main" start \
  --task "T-auth-refresh" \
  --summary "Refresh-token rotation and retry handling" \
  --scope "src/auth/*, tests/auth/*"
```

If an active task is already owned by another participant, do not edit its declared scope until ownership is clarified or an explicit handoff is recorded.

### During work

Update only after meaningful milestones, not after every command or tool call.

```bash
python3 "$SCRIPT" --agent "codex-main" progress \
  --task "T-auth-refresh" \
  --message "Implemented rotation; adding expired-token regression tests"

python3 "$SCRIPT" --agent "codex-main" decision \
  --topic "Refresh token storage" \
  --message "Store only token hashes" \
  --rationale "Limits exposure if the database is leaked"

python3 "$SCRIPT" --agent "codex-main" note \
  --kind test \
  --task "T-auth-refresh" \
  --message "pytest tests/auth: 24 passed"
```

Record a blocker immediately:

```bash
python3 "$SCRIPT" --agent "codex-main" block \
  --task "T-auth-refresh" \
  --message "Waiting for the identity-provider sandbox credentials"
```

When the blocker is resolved:

```bash
python3 "$SCRIPT" --agent "codex-main" unblock \
  --task "T-auth-refresh" \
  --message "Sandbox credentials received and verified"
```

### Before stopping or replying with a final result

Mark the task complete or hand it off. Include what changed, verification performed, and the next concrete action.

```bash
python3 "$SCRIPT" --agent "codex-main" done \
  --task "T-auth-refresh" \
  --message "Implemented rotation and retry handling; auth tests pass"

python3 "$SCRIPT" --agent "codex-main" handoff \
  --task "T-auth-refresh" \
  --to "claude-review" \
  --message "Implementation is ready for review" \
  --next "Review retry edge cases and run the full integration suite"
```

Use `handoff` instead of silently changing another participant's ownership.

## Event selection

Use the narrowest matching command:

- `start`: claim a new task and declare its file or subsystem scope.
- `progress`: record a meaningful intermediate result.
- `decision`: record a durable technical or product decision and its rationale.
- `block` / `unblock`: expose or clear a dependency that affects progress.
- `note --kind request`: summarize an important user or coordinator request.
- `note --kind response`: summarize a delivered answer or result.
- `note --kind finding|change|test|note`: record supporting facts.
- `handoff`: transfer ownership with explicit next steps.
- `done`: close a task with result and verification details.
- `compact`: trim old log entries while preserving current task state.

## Conflict rules

- Treat task scope as a coordination boundary, not an exclusive filesystem lock.
- Do not use `--force` merely to bypass an ownership error.
- Use `--force` only for an intentional takeover, reopening a completed task, or recovery from stale metadata. Record a `note` explaining why.
- Re-read `WORKSPACE_STATUS.md` after an ownership conflict or before editing files another active task lists in its scope.
- If multiple worktrees need one shared status, set `WORKSPACE_STATUS_FILE` to the same absolute path for every worktree.

## Logging rules

Write concise, verifiable facts.

Include:
- requested outcome,
- changed files or subsystem,
- decisions and rationale,
- test/build results,
- blockers,
- remaining work,
- ownership and handoff.

Never include:
- passwords, API keys, tokens, private keys, or confidential payloads,
- hidden reasoning or chain-of-thought,
- large command output, full diffs, or full chat transcripts,
- speculation presented as fact.

Summarize conversation turns rather than copying them verbatim. A useful log entry should help the next participant act without rereading the full chat.

## Maintenance

The script serializes updates with a short-lived directory lock and writes the Markdown atomically. Do not hand-edit the encoded machine-state line. Manual prose may be added only outside generated content, but subsequent script renders replace the generated document body.

Compact long histories when the file becomes noisy:

```bash
python3 "$SCRIPT" compact --keep-log 200 --keep-decisions 40 --keep-handoffs 40
```
