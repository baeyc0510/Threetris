#!/usr/bin/env python3
"""Export the current Codex chat transcript (rollout) to a Markdown file.

Portable across users and platforms: it finds the Codex session whose recorded
working directory matches the current repo, so anyone using this repository can
run it without editing paths or session IDs.

Usage:
    python3 export_chat.py [--session <id>] [--out-dir <dir>] [--reasoning] [--tool-results]

Codex stores sessions under:
    ${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl

Selection order:
    1. --session <id>   explicit session/rollout id (uuid substring match)
    2. newest rollout whose session_meta.cwd matches the current directory
    3. newest rollout overall (with a warning) if none match
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def codex_home() -> Path:
    override = os.environ.get("CODEX_HOME")
    return Path(override) if override else (Path.home() / ".codex")


def sessions_dir() -> Path:
    return codex_home() / "sessions"


def norm(p: str | None) -> str:
    if not p:
        return ""
    return os.path.normcase(os.path.normpath(str(p))).replace("\\", "/").rstrip("/")


def read_meta(path: Path) -> dict:
    """Return the session_meta payload from a rollout file (first matching line)."""
    try:
        with path.open(encoding="utf-8") as fh:
            for _ in range(5):  # meta is at the top
                line = fh.readline()
                if not line:
                    break
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("type") == "session_meta":
                    return rec.get("payload", {}) or {}
    except OSError:
        pass
    return {}


def pick_rollout(sdir: Path, session: str | None, cwd: Path) -> Path:
    if not sdir.is_dir():
        sys.exit(f"No Codex sessions directory found: {sdir}\n"
                 "Is Codex installed and has it recorded a session for this repo?")
    files = sorted(sdir.rglob("rollout-*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        sys.exit(f"No rollout-*.jsonl files under {sdir}")

    if session:
        for f in files:
            meta = read_meta(f)
            if session in f.name or session == meta.get("session_id") or session == meta.get("id"):
                return f
        sys.exit(f"No rollout matches session '{session}'")

    target = norm(cwd)
    for f in files:  # newest first
        if norm(read_meta(f).get("cwd")) == target:
            return f
    print(f"WARNING: no Codex session recorded for {cwd}; using newest overall.", file=sys.stderr)
    return files[0]


# --- content rendering -------------------------------------------------------

# Codex injects context into user turns: XML-ish wrappers (<recommended_plugins>,
# <environment_context>, <permissions instructions>, ...), repository instructions,
# and IDE context blocks. Keep the transcript focused on actual conversation.
_OPEN_TAG = re.compile(r"^<[a-zA-Z][\w-]*(\s|>|/|$)")
_AGENTS_INSTRUCTIONS = re.compile(
    r"(?ms)^# AGENTS\.md instructions[^\n\r]*(?:\r?\n\s*)?<INSTRUCTIONS>.*?</INSTRUCTIONS>\s*"
)
_USER_REQUEST = re.compile(r"(?ms)^## My request for (?:Codex|Claude Code|Claude):\s*")
_INJECTED_PLAIN = ("# Context from my IDE", "# Context from the IDE")


def texts(content, keys) -> list[str]:
    out = []
    if isinstance(content, str):
        return [content]
    if isinstance(content, list):
        for b in content:
            if isinstance(b, dict) and b.get("type") in keys:
                t = b.get("text", "")
                if t:
                    out.append(t)
    return out


def is_injected(text: str) -> bool:
    s = text.lstrip()
    return bool(_OPEN_TAG.match(s)) or s.startswith(_INJECTED_PLAIN)


def strip_injected_blocks(text: str) -> str:
    text = _AGENTS_INSTRUCTIONS.sub("", text)
    request = _USER_REQUEST.search(text)
    if request:
        return text[request.end():]
    return text


def summarize_args(raw) -> str:
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return (str(raw).replace("\n", " ")[:120]) if raw else ""
    if not isinstance(data, dict):
        return str(data)[:120]
    for key in ("command", "cmd", "file_path", "path", "query", "pattern"):
        if key in data:
            val = data[key]
            if isinstance(val, list):
                val = " ".join(map(str, val))
            val = str(val).replace("\n", " ").strip()
            return (val[:117] + "...") if len(val) > 120 else val
    s = json.dumps(data, ensure_ascii=False)
    return (s[:117] + "...") if len(s) > 120 else s


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", help="Session/rollout id (default: match current cwd, newest)")
    ap.add_argument("--out-dir", default="chat_logs", help="Output directory (default: chat_logs)")
    ap.add_argument("--reasoning", action="store_true", help="Include reasoning summaries when present")
    ap.add_argument("--tool-results", action="store_true", help="Include (truncated) tool outputs")
    args = ap.parse_args()

    cwd = Path.cwd()
    rollout = pick_rollout(sessions_dir(), args.session, cwd)
    meta = read_meta(rollout)
    session_id = meta.get("session_id") or meta.get("id") or rollout.stem

    lines: list[str] = []
    first_ts = last_ts = None
    with rollout.open(encoding="utf-8") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            try:
                rec = json.loads(raw)
            except json.JSONDecodeError:
                continue
            ts = rec.get("timestamp")
            if ts:
                first_ts = first_ts or ts
                last_ts = ts
            if rec.get("type") != "response_item":
                continue
            p = rec.get("payload", {})
            ptype = p.get("type")

            if ptype == "message":
                role = p.get("role")
                if role == "user":
                    for t in texts(p.get("content"), ("input_text", "text")):
                        t = strip_injected_blocks(t).strip()
                        if t and not is_injected(t):
                            lines.append(f"## 🧑 User\n\n{t}\n")
                elif role == "assistant":
                    body = [t.strip() for t in texts(p.get("content"), ("output_text", "text")) if t.strip()]
                    if body:
                        lines.append("## 🤖 Assistant\n\n" + "\n\n".join(body) + "\n")
            elif ptype in ("function_call", "custom_tool_call"):
                name = p.get("name", "tool")
                raw_args = p.get("arguments", p.get("input", ""))
                lines.append(f"> 🔧 **{name}**({summarize_args(raw_args)})\n")
            elif ptype == "reasoning" and args.reasoning:
                summ = p.get("summary") or []
                chunks = [s.get("text", "") for s in summ if isinstance(s, dict) and s.get("text")]
                if chunks:
                    lines.append(f"<details><summary>💭 reasoning</summary>\n\n{' '.join(chunks)}\n\n</details>\n")
            elif ptype in ("function_call_output", "custom_tool_call_output") and args.tool_results:
                out = p.get("output", "")
                if isinstance(out, dict):
                    out = out.get("output", json.dumps(out, ensure_ascii=False))
                out = str(out).strip()
                if len(out) > 500:
                    out = out[:500] + "\n...[truncated]"
                if out:
                    lines.append("> **Tool output:**\n> ```\n> " + out.replace("\n", "\n> ") + "\n> ```\n")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    date = (first_ts or datetime.now(timezone.utc).isoformat())[:10]
    out_path = out_dir / f"{date}_codex_{session_id}.md"

    header = (
        f"# Chat log (Codex)\n\n"
        f"- **Session:** `{session_id}`\n"
        f"- **Project:** `{meta.get('cwd', cwd)}`\n"
        f"- **Model:** {meta.get('model_provider', '?')} / {meta.get('originator', '?')}\n"
        f"- **Started:** {first_ts or 'unknown'}\n"
        f"- **Last message:** {last_ts or 'unknown'}\n"
        f"- **Exported:** {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n\n"
        f"---\n\n"
    )
    out_path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"Saved chat log -> {out_path}")


if __name__ == "__main__":
    main()
