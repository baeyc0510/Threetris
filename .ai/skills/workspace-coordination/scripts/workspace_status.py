#!/usr/bin/env python3
"""Maintain a single Markdown coordination file for parallel agents and humans."""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from typing import Any

STATE_PREFIX = "<!-- workspace-status-state:v1:"
STATE_SUFFIX = " -->"
SCHEMA_VERSION = 1
DEFAULT_FILENAME = "WORKSPACE_STATUS.md"
LOCK_TIMEOUT_SECONDS = 12.0
STALE_LOCK_SECONDS = 120.0


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def compact_time(value: str) -> str:
    try:
        dt = datetime.fromisoformat(value)
        return dt.strftime("%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        return value


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def md_text(value: str | None) -> str:
    value = clean_text(value)
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("`", "\\`")


def agent_default() -> str:
    for key in (
        "WORKSPACE_AGENT",
        "CLAUDE_AGENT_NAME",
        "CODEX_AGENT_NAME",
        "AGENT_NAME",
    ):
        value = clean_text(os.getenv(key))
        if value:
            return value
    user = clean_text(os.getenv("USER") or os.getenv("USERNAME")) or "unknown"
    return f"{user}@{socket.gethostname()}"


def git_root(cwd: Path) -> Path:
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=str(cwd),
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        root = clean_text(proc.stdout)
        if root:
            return Path(root).resolve()
    except (OSError, subprocess.CalledProcessError):
        pass
    return cwd.resolve()


def resolve_status_path(explicit: str | None) -> Path:
    raw = explicit or os.getenv("WORKSPACE_STATUS_FILE")
    if raw:
        return Path(raw).expanduser().resolve()
    return git_root(Path.cwd()) / DEFAULT_FILENAME


def empty_state(path: Path) -> dict[str, Any]:
    stamp = now_iso()
    return {
        "schema_version": SCHEMA_VERSION,
        "workspace": path.parent.name or str(path.parent),
        "created_at": stamp,
        "updated_at": stamp,
        "tasks": {},
        "decisions": [],
        "handoffs": [],
        "activity": [],
    }


def encode_state(state: dict[str, Any]) -> str:
    raw = json.dumps(
        state,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(raw).decode("ascii")
    return f"{STATE_PREFIX}{encoded}{STATE_SUFFIX}"


def decode_state(text: str) -> dict[str, Any]:
    first_line = text.splitlines()[0] if text else ""
    if not (first_line.startswith(STATE_PREFIX) and first_line.endswith(STATE_SUFFIX)):
        raise ValueError("The file is not managed by workspace_status.py.")
    encoded = first_line[len(STATE_PREFIX) : -len(STATE_SUFFIX)]
    try:
        raw = base64.urlsafe_b64decode(encoded.encode("ascii"))
        state = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise ValueError("The encoded workspace state is invalid.") from exc
    if state.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported schema version: {state.get('schema_version')!r}"
        )
    return state


class DirectoryLock:
    def __init__(self, target: Path, timeout: float = LOCK_TIMEOUT_SECONDS) -> None:
        self.path = target.parent / f".{target.name}.lock"
        self.timeout = timeout
        self.acquired = False

    def __enter__(self) -> "DirectoryLock":
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                self.path.mkdir(parents=False)
                owner = {
                    "pid": os.getpid(),
                    "host": socket.gethostname(),
                    "created_at": now_iso(),
                }
                (self.path / "owner.json").write_text(
                    json.dumps(owner, ensure_ascii=False),
                    encoding="utf-8",
                )
                self.acquired = True
                return self
            except FileExistsError:
                try:
                    age = time.time() - self.path.stat().st_mtime
                    if age > STALE_LOCK_SECONDS:
                        shutil.rmtree(self.path, ignore_errors=True)
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"Could not acquire lock: {self.path}"
                    )
                time.sleep(0.08)

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self.acquired:
            shutil.rmtree(self.path, ignore_errors=True)


def read_state(path: Path, allow_missing: bool = False) -> dict[str, Any]:
    if not path.exists():
        if allow_missing:
            return empty_state(path)
        raise FileNotFoundError(
            f"{path} does not exist. Run the 'init' command first."
        )
    return decode_state(path.read_text(encoding="utf-8"))


def activity_line(entry: dict[str, Any]) -> str:
    timestamp = compact_time(entry["timestamp"])
    agent = md_text(entry.get("agent"))
    kind = md_text(entry.get("kind"))
    task = clean_text(entry.get("task"))
    task_part = f" · `{md_text(task)}`" if task else ""
    message = md_text(entry.get("message"))
    return f"- {timestamp} · **{agent}** · `{kind}`{task_part} — {message}"


def render(state: dict[str, Any]) -> str:
    tasks = list(state.get("tasks", {}).values())
    active = sorted(
        (task for task in tasks if task.get("status") in {"active", "blocked"}),
        key=lambda task: (task.get("status") == "blocked", task.get("id", "")),
    )
    completed = sorted(
        (task for task in tasks if task.get("status") == "done"),
        key=lambda task: task.get("updated_at", ""),
        reverse=True,
    )[:12]
    blocked_count = sum(task.get("status") == "blocked" for task in active)

    lines: list[str] = [
        encode_state(state),
        "# Workspace Coordination",
        "",
        "> Shared status for agents and humans. Managed by the `workspace-coordination` skill.",
        "> Do not edit the encoded first line. Do not record secrets or hidden reasoning.",
        "",
        "## Current Snapshot",
        "",
        f"- **Workspace:** {md_text(state.get('workspace'))}",
        f"- **Updated:** {compact_time(state.get('updated_at', ''))}",
        f"- **Active tasks:** {len(active)}",
        f"- **Blocked tasks:** {blocked_count}",
        "",
        "## Active Tasks",
        "",
    ]

    if active:
        lines.extend(
            [
                "| Task | Owner | Status | Summary | Scope | Updated |",
                "|---|---|---|---|---|---|",
            ]
        )
        for task in active:
            lines.append(
                "| `{id}` | {owner} | {status} | {summary} | {scope} | {updated} |".format(
                    id=md_text(task.get("id")),
                    owner=md_text(task.get("owner")),
                    status=md_text(task.get("status")),
                    summary=md_text(task.get("summary")),
                    scope=md_text(task.get("scope")) or "—",
                    updated=compact_time(task.get("updated_at", "")),
                )
            )
    else:
        lines.append("_No active tasks._")

    lines.extend(["", "## Blockers", ""])
    blocked = [task for task in active if task.get("status") == "blocked"]
    if blocked:
        lines.extend(
            [
                "| Task | Owner | Blocker | Updated |",
                "|---|---|---|---|",
            ]
        )
        for task in blocked:
            lines.append(
                "| `{id}` | {owner} | {blocker} | {updated} |".format(
                    id=md_text(task.get("id")),
                    owner=md_text(task.get("owner")),
                    blocker=md_text(task.get("blocker")),
                    updated=compact_time(task.get("updated_at", "")),
                )
            )
    else:
        lines.append("_No blockers._")

    lines.extend(["", "## Recent Decisions", ""])
    decisions = state.get("decisions", [])
    if decisions:
        for item in reversed(decisions[-40:]):
            rationale = clean_text(item.get("rationale"))
            suffix = f" Rationale: {md_text(rationale)}" if rationale else ""
            lines.append(
                f"- {compact_time(item['timestamp'])} · **{md_text(item['agent'])}** "
                f"· **{md_text(item['topic'])}** — {md_text(item['message'])}.{suffix}"
            )
    else:
        lines.append("_No decisions recorded._")

    lines.extend(["", "## Recent Handoffs", ""])
    handoffs = state.get("handoffs", [])
    if handoffs:
        for item in reversed(handoffs[-40:]):
            next_step = clean_text(item.get("next"))
            suffix = f" Next: {md_text(next_step)}" if next_step else ""
            lines.append(
                f"- {compact_time(item['timestamp'])} · `{md_text(item['task'])}` "
                f"· **{md_text(item['from'])} → {md_text(item['to'])}** — "
                f"{md_text(item['message'])}.{suffix}"
            )
    else:
        lines.append("_No handoffs recorded._")

    lines.extend(["", "## Recently Completed", ""])
    if completed:
        lines.extend(
            [
                "| Task | Owner | Result | Updated |",
                "|---|---|---|---|",
            ]
        )
        for task in completed:
            lines.append(
                "| `{id}` | {owner} | {result} | {updated} |".format(
                    id=md_text(task.get("id")),
                    owner=md_text(task.get("owner")),
                    result=md_text(task.get("result") or task.get("summary")),
                    updated=compact_time(task.get("updated_at", "")),
                )
            )
    else:
        lines.append("_No completed tasks recorded._")

    lines.extend(["", "## Activity Log", ""])
    activity = state.get("activity", [])
    if activity:
        lines.extend(activity_line(entry) for entry in reversed(activity))
    else:
        lines.append("_No activity recorded._")

    lines.extend(
        [
            "",
            "## Coordination Protocol",
            "",
            "- Read this file before substantial work.",
            "- Claim a task and declare its scope before editing.",
            "- Record meaningful milestones, decisions, blockers, test results, and handoffs.",
            "- Do not paste full transcripts, diffs, secrets, or hidden reasoning.",
            "- Use the bundled script so updates remain atomic and machine-readable.",
            "",
        ]
    )
    return "\n".join(lines)


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
        text=True,
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


def save_state(path: Path, state: dict[str, Any]) -> None:
    state["updated_at"] = now_iso()
    atomic_write(path, render(state))


def add_activity(
    state: dict[str, Any],
    *,
    agent: str,
    kind: str,
    message: str,
    task: str | None = None,
) -> None:
    state.setdefault("activity", []).append(
        {
            "timestamp": now_iso(),
            "agent": clean_text(agent),
            "kind": clean_text(kind),
            "task": clean_text(task),
            "message": clean_text(message),
        }
    )


def require_task(
    state: dict[str, Any],
    task_id: str,
) -> dict[str, Any]:
    task = state.get("tasks", {}).get(task_id)
    if task is None:
        raise ValueError(f"Unknown task: {task_id}")
    return task


def verify_owner(
    task: dict[str, Any],
    agent: str,
    force: bool,
) -> None:
    owner = clean_text(task.get("owner"))
    if owner and owner != agent and not force:
        raise PermissionError(
            f"Task {task['id']} is owned by {owner!r}, not {agent!r}. "
            "Use handoff or --force for an intentional takeover."
        )


def command_init(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        if path.exists() and not args.force:
            decode_state(path.read_text(encoding="utf-8"))
            return f"Already initialized: {path}"
        if path.exists() and args.force:
            backup = path.with_suffix(path.suffix + f".backup-{int(time.time())}")
            shutil.copy2(path, backup)
        state = empty_state(path)
        add_activity(
            state,
            agent=args.agent,
            kind="init",
            message="Initialized shared workspace coordination file",
        )
        save_state(path, state)
    return f"Initialized: {path}"


def command_show(path: Path, args: argparse.Namespace) -> str:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} does not exist. Run the 'init' command first."
        )
    decode_state(path.read_text(encoding="utf-8"))
    return path.read_text(encoding="utf-8")


def command_start(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        tasks = state.setdefault("tasks", {})
        existing = tasks.get(args.task)
        stamp = now_iso()
        if existing:
            if not args.force:
                raise ValueError(
                    f"Task {args.task} already exists with status "
                    f"{existing.get('status')!r} and owner {existing.get('owner')!r}."
                )
            existing.update(
                {
                    "owner": args.agent,
                    "status": "active",
                    "summary": clean_text(args.summary),
                    "scope": clean_text(args.scope),
                    "blocker": "",
                    "result": "",
                    "updated_at": stamp,
                }
            )
        else:
            tasks[args.task] = {
                "id": args.task,
                "owner": args.agent,
                "status": "active",
                "summary": clean_text(args.summary),
                "scope": clean_text(args.scope),
                "blocker": "",
                "result": "",
                "created_at": stamp,
                "updated_at": stamp,
            }
        add_activity(
            state,
            agent=args.agent,
            kind="start" if not existing else "takeover",
            task=args.task,
            message=args.summary,
        )
        save_state(path, state)
    return f"Task active: {args.task} ({args.agent})"


def command_progress(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        task = require_task(state, args.task)
        verify_owner(task, args.agent, args.force)
        if task.get("status") == "done" and not args.force:
            raise ValueError(f"Task {args.task} is completed. Reopen it with start --force.")
        task["owner"] = args.agent
        task["status"] = "active"
        task["blocker"] = ""
        if clean_text(args.scope):
            task["scope"] = clean_text(args.scope)
        task["updated_at"] = now_iso()
        add_activity(
            state,
            agent=args.agent,
            kind="progress",
            task=args.task,
            message=args.message,
        )
        save_state(path, state)
    return f"Progress recorded: {args.task}"


def command_block(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        task = require_task(state, args.task)
        verify_owner(task, args.agent, args.force)
        task["owner"] = args.agent
        task["status"] = "blocked"
        task["blocker"] = clean_text(args.message)
        task["updated_at"] = now_iso()
        add_activity(
            state,
            agent=args.agent,
            kind="blocker",
            task=args.task,
            message=args.message,
        )
        save_state(path, state)
    return f"Task blocked: {args.task}"


def command_unblock(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        task = require_task(state, args.task)
        verify_owner(task, args.agent, args.force)
        task["owner"] = args.agent
        task["status"] = "active"
        task["blocker"] = ""
        task["updated_at"] = now_iso()
        add_activity(
            state,
            agent=args.agent,
            kind="unblock",
            task=args.task,
            message=args.message,
        )
        save_state(path, state)
    return f"Task unblocked: {args.task}"


def command_done(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        task = require_task(state, args.task)
        verify_owner(task, args.agent, args.force)
        task["owner"] = args.agent
        task["status"] = "done"
        task["blocker"] = ""
        task["result"] = clean_text(args.message)
        task["updated_at"] = now_iso()
        add_activity(
            state,
            agent=args.agent,
            kind="done",
            task=args.task,
            message=args.message,
        )
        save_state(path, state)
    return f"Task completed: {args.task}"


def command_decision(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        state.setdefault("decisions", []).append(
            {
                "timestamp": now_iso(),
                "agent": args.agent,
                "topic": clean_text(args.topic),
                "message": clean_text(args.message),
                "rationale": clean_text(args.rationale),
            }
        )
        add_activity(
            state,
            agent=args.agent,
            kind="decision",
            message=f"{args.topic}: {args.message}",
        )
        save_state(path, state)
    return f"Decision recorded: {args.topic}"


def command_handoff(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        task = require_task(state, args.task)
        verify_owner(task, args.agent, args.force)
        previous_owner = clean_text(task.get("owner")) or args.agent
        task["owner"] = clean_text(args.to)
        if task.get("status") == "done":
            task["status"] = "active"
            task["result"] = ""
        task["updated_at"] = now_iso()
        state.setdefault("handoffs", []).append(
            {
                "timestamp": now_iso(),
                "task": args.task,
                "from": previous_owner,
                "to": clean_text(args.to),
                "message": clean_text(args.message),
                "next": clean_text(args.next),
            }
        )
        add_activity(
            state,
            agent=args.agent,
            kind="handoff",
            task=args.task,
            message=f"To {args.to}: {args.message}"
            + (f"; next: {args.next}" if clean_text(args.next) else ""),
        )
        save_state(path, state)
    return f"Task handed off: {args.task} -> {args.to}"


def command_note(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        if args.task:
            require_task(state, args.task)
        add_activity(
            state,
            agent=args.agent,
            kind=args.kind,
            task=args.task,
            message=args.message,
        )
        save_state(path, state)
    return f"Note recorded: {args.kind}"


def command_compact(path: Path, args: argparse.Namespace) -> str:
    with DirectoryLock(path):
        state = read_state(path)
        state["activity"] = state.get("activity", [])[-args.keep_log :]
        state["decisions"] = state.get("decisions", [])[-args.keep_decisions :]
        state["handoffs"] = state.get("handoffs", [])[-args.keep_handoffs :]
        add_activity(
            state,
            agent=args.agent,
            kind="compact",
            message=(
                f"Trimmed history to log={args.keep_log}, "
                f"decisions={args.keep_decisions}, handoffs={args.keep_handoffs}"
            ),
        )
        save_state(path, state)
    return f"Compacted: {path}"


def add_force(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--force",
        action="store_true",
        help="Intentionally override ownership or existing state.",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Maintain a shared WORKSPACE_STATUS.md for parallel work."
    )
    parser.add_argument(
        "--file",
        help="Status Markdown path. Defaults to WORKSPACE_STATUS_FILE or Git root.",
    )
    parser.add_argument(
        "--agent",
        default=agent_default(),
        help="Stable participant identifier for this session.",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="Initialize the status file.")
    add_force(p_init)

    sub.add_parser("show", help="Print the current Markdown status.")

    p_start = sub.add_parser("start", help="Create or intentionally reclaim a task.")
    p_start.add_argument("--task", required=True)
    p_start.add_argument("--summary", required=True)
    p_start.add_argument("--scope", default="")
    add_force(p_start)

    p_progress = sub.add_parser("progress", help="Record a meaningful milestone.")
    p_progress.add_argument("--task", required=True)
    p_progress.add_argument("--message", required=True)
    p_progress.add_argument("--scope", default="")
    add_force(p_progress)

    p_block = sub.add_parser("block", help="Mark a task blocked.")
    p_block.add_argument("--task", required=True)
    p_block.add_argument("--message", required=True)
    add_force(p_block)

    p_unblock = sub.add_parser("unblock", help="Clear a task blocker.")
    p_unblock.add_argument("--task", required=True)
    p_unblock.add_argument("--message", required=True)
    add_force(p_unblock)

    p_done = sub.add_parser("done", help="Complete a task.")
    p_done.add_argument("--task", required=True)
    p_done.add_argument("--message", required=True)
    add_force(p_done)

    p_decision = sub.add_parser("decision", help="Record a durable decision.")
    p_decision.add_argument("--topic", required=True)
    p_decision.add_argument("--message", required=True)
    p_decision.add_argument("--rationale", default="")

    p_handoff = sub.add_parser("handoff", help="Transfer task ownership.")
    p_handoff.add_argument("--task", required=True)
    p_handoff.add_argument("--to", required=True)
    p_handoff.add_argument("--message", required=True)
    p_handoff.add_argument("--next", default="")
    add_force(p_handoff)

    p_note = sub.add_parser("note", help="Record a concise supporting fact.")
    p_note.add_argument(
        "--kind",
        choices=("request", "response", "finding", "change", "test", "note"),
        default="note",
    )
    p_note.add_argument("--task")
    p_note.add_argument("--message", required=True)

    p_compact = sub.add_parser("compact", help="Trim old history.")
    p_compact.add_argument("--keep-log", type=int, default=200)
    p_compact.add_argument("--keep-decisions", type=int, default=40)
    p_compact.add_argument("--keep-handoffs", type=int, default=40)

    return parser


COMMANDS = {
    "init": command_init,
    "show": command_show,
    "start": command_start,
    "progress": command_progress,
    "block": command_block,
    "unblock": command_unblock,
    "done": command_done,
    "decision": command_decision,
    "handoff": command_handoff,
    "note": command_note,
    "compact": command_compact,
}


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    path = resolve_status_path(args.file)
    try:
        output = COMMANDS[args.command](path, args)
        print(output)
        return 0
    except (FileNotFoundError, ValueError, PermissionError, TimeoutError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("error: interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
