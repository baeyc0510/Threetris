#!/usr/bin/env python3
"""Export the current Claude Code chat transcript to a Markdown file.

Portable across users and platforms: it derives the transcript location from
the current working directory and the Claude config dir, so anyone using this
repository can run it without editing paths or session IDs.

Usage:
    python3 export_chat.py [--session <id>] [--out-dir <dir>] [--thinking]

Resolution order for the transcript:
    1. --session <id>            explicit session id
    2. $CLAUDE_SESSION_ID        env var set by Claude Code for the live session
    3. newest *.jsonl            most recently modified transcript for this repo
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def config_dir() -> Path:
    """Claude config dir, honoring CLAUDE_CONFIG_DIR overrides."""
    override = os.environ.get("CLAUDE_CONFIG_DIR")
    if override:
        return Path(override)
    return Path.home() / ".claude"


def encode_project_path(cwd: Path) -> str:
    """Match Claude Code's project-dir encoding: non-alphanumerics -> '-'."""
    return re.sub(r"[^a-zA-Z0-9]", "-", str(cwd))


def transcript_dir(cwd: Path) -> Path:
    return config_dir() / "projects" / encode_project_path(cwd)


def pick_transcript(tdir: Path, session: str | None) -> Path:
    if not tdir.is_dir():
        sys.exit(f"No transcript directory found: {tdir}\n"
                 "Are you running this inside a Claude Code session for this repo?")
    if session:
        p = tdir / f"{session}.jsonl"
        if not p.is_file():
            sys.exit(f"No transcript for session {session} at {p}")
        return p
    files = sorted(tdir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        sys.exit(f"No .jsonl transcripts in {tdir}")
    return files[0]


def blocks(content) -> list:
    """Normalize a message's content into a list of blocks."""
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        return content
    return []


def summarize_input(data) -> str:
    """One-line summary of a tool_use input."""
    if not isinstance(data, dict):
        return ""
    parts = []
    for key in ("command", "file_path", "path", "pattern", "prompt", "description", "url", "query"):
        if key in data and isinstance(data[key], str):
            val = data[key].replace("\n", " ").strip()
            if len(val) > 120:
                val = val[:117] + "..."
            parts.append(f"{key}={val}")
    if parts:
        return "; ".join(parts)
    text = json.dumps(data, ensure_ascii=False)
    return text[:120] + ("..." if len(text) > 120 else "")


def render_user(content, include_tool_results: bool) -> list[str]:
    out = []
    for b in blocks(content):
        btype = b.get("type")
        if btype == "text":
            text = b.get("text", "").strip()
            # Skip harness-injected reminders so the log stays readable.
            if text.startswith("<system-reminder>") or not text:
                continue
            out.append(f"## 🧑 User\n\n{text}\n")
        elif btype == "tool_result" and include_tool_results:
            res = b.get("content", "")
            if isinstance(res, list):
                res = " ".join(
                    x.get("text", "") for x in res if isinstance(x, dict) and x.get("type") == "text"
                )
            res = str(res).strip()
            if len(res) > 500:
                res = res[:500] + "\n...[truncated]"
            if res:
                out.append(f"> **Tool result:**\n> ```\n> " + res.replace("\n", "\n> ") + "\n> ```\n")
    return out


def render_assistant(content, include_thinking: bool) -> list[str]:
    out = []
    header_done = False
    for b in blocks(content):
        btype = b.get("type")
        if btype == "text":
            text = b.get("text", "").strip()
            if not text:
                continue
            if not header_done:
                out.append("## 🤖 Assistant\n")
                header_done = True
            out.append(f"{text}\n")
        elif btype == "thinking" and include_thinking:
            think = (b.get("thinking") or b.get("text") or "").strip()
            if think:
                out.append(f"<details><summary>💭 thinking</summary>\n\n{think}\n\n</details>\n")
        elif btype == "tool_use":
            name = b.get("name", "tool")
            summary = summarize_input(b.get("input"))
            out.append(f"> 🔧 **{name}**({summary})\n")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", help="Session id (default: $CLAUDE_SESSION_ID or newest)")
    ap.add_argument("--out-dir", default="chat_logs", help="Output directory (default: chat_logs)")
    ap.add_argument("--thinking", action="store_true", help="Include assistant thinking blocks")
    ap.add_argument("--tool-results", action="store_true", help="Include (truncated) tool results")
    args = ap.parse_args()

    cwd = Path.cwd()
    session = args.session or os.environ.get("CLAUDE_SESSION_ID")
    tpath = pick_transcript(transcript_dir(cwd), session)
    session_id = tpath.stem

    lines: list[str] = []
    first_ts = last_ts = None
    with tpath.open(encoding="utf-8") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            try:
                rec = json.loads(raw)
            except json.JSONDecodeError:
                continue
            rtype = rec.get("type")
            ts = rec.get("timestamp")
            if ts:
                first_ts = first_ts or ts
                last_ts = ts
            if rtype == "user":
                msg = rec.get("message", {})
                lines += render_user(msg.get("content"), args.tool_results)
            elif rtype == "assistant":
                msg = rec.get("message", {})
                lines += render_assistant(msg.get("content"), args.thinking)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    date = (first_ts or datetime.now(timezone.utc).isoformat())[:10]
    out_path = out_dir / f"{date}_{session_id}.md"

    header = (
        f"# Chat log\n\n"
        f"- **Session:** `{session_id}`\n"
        f"- **Project:** `{cwd}`\n"
        f"- **Started:** {first_ts or 'unknown'}\n"
        f"- **Last message:** {last_ts or 'unknown'}\n"
        f"- **Exported:** {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n\n"
        f"---\n\n"
    )
    out_path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"Saved chat log -> {out_path}")


if __name__ == "__main__":
    main()
