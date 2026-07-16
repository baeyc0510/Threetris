#!/usr/bin/env python3
"""Maintain a main-aware SOURCE_MAP.md for a Git repository.

The script treats the resolved source tree as the source of truth. Generated
content is rebuilt; only the manual region is 3-way merged during conflicts.
"""

from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from typing import Any, Iterable, Sequence

STATE_PREFIX = "<!-- source-map-state:v1:"
STATE_SUFFIX = " -->"
MANUAL_START = "<!-- source-map:manual:start -->"
MANUAL_END = "<!-- source-map:manual:end -->"
AUTO_START = "<!-- source-map:auto:start -->"
AUTO_END = "<!-- source-map:auto:end -->"
DEFAULT_FILENAME = "SOURCE_MAP.md"
SCHEMA_VERSION = 1
MANUAL_CONFLICT_EXIT = 3

SOURCE_EXTENSIONS = {
    ".py", ".pyi", ".pyx",
    ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx",
    ".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx",
    ".cs", ".java", ".kt", ".kts", ".scala",
    ".go", ".rs", ".swift", ".m", ".mm",
    ".rb", ".php", ".lua", ".gd", ".dart",
    ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
    ".sql", ".graphql", ".gql",
    ".glsl", ".hlsl", ".metal", ".vert", ".frag", ".comp", ".compute",
    ".shader", ".cginc", ".usf", ".ush",
    ".cmake", ".gradle", ".sbt", ".asmdef", ".uproject", ".uplugin",
}
SPECIAL_SOURCE_NAMES = {
    "CMakeLists.txt", "Makefile", "GNUmakefile", "Dockerfile",
    "meson.build", "meson_options.txt", "BUILD", "BUILD.bazel", "WORKSPACE",
    "Rakefile", "Gemfile", "Podfile",
}
IGNORED_DIR_NAMES = {
    ".git", ".hg", ".svn", ".idea", ".vscode",
    "node_modules", "vendor", "third_party", "ThirdParty", "External",
    ".venv", "venv", "env", "__pycache__", ".pytest_cache", ".mypy_cache",
    "build", "dist", "out", "bin", "obj", "target", "coverage",
    "Library", "Temp", "Logs", "Binaries", "Intermediate", "Saved",
    "DerivedDataCache", ".gradle", ".next", ".nuxt",
}
CONFLICT_RE = re.compile(r"^(<<<<<<<|=======|>>>>>>>)", re.MULTILINE)
STATE_RE = re.compile(r"<!-- source-map-state:v1:([A-Za-z0-9_\-=]+) -->")


class SourceMapError(RuntimeError):
    pass


@dataclass(frozen=True)
class Change:
    status: str
    path: str
    old_path: str = ""


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def run_git(
    repo: Path,
    args: Sequence[str],
    *,
    check: bool = True,
    text: bool = True,
    input_data: str | bytes | None = None,
) -> subprocess.CompletedProcess[Any]:
    proc = subprocess.run(
        ["git", *args],
        cwd=str(repo),
        input=input_data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=text,
        check=False,
    )
    if check and proc.returncode != 0:
        stderr = proc.stderr.strip() if text else proc.stderr.decode("utf-8", "replace").strip()
        raise SourceMapError(f"git {' '.join(shlex.quote(a) for a in args)} failed: {stderr}")
    return proc


def repo_root(start: Path) -> Path:
    proc = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=str(start),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise SourceMapError("Run this command inside a Git repository.")
    return Path(proc.stdout.strip()).resolve()


def git_path(repo: Path, name: str) -> Path:
    value = run_git(repo, ["rev-parse", "--git-path", name]).stdout.strip()
    path = Path(value)
    return path if path.is_absolute() else (repo / path).resolve()


def operation_in_progress(repo: Path) -> bool:
    names = ["MERGE_HEAD", "REBASE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD"]
    return any(git_path(repo, name).exists() for name in names)


def resolve_output_path(repo: Path, explicit: str | None) -> Path:
    raw = explicit or os.getenv("SOURCE_MAP_FILE")
    if raw:
        path = Path(raw).expanduser()
        return path.resolve() if path.is_absolute() else (repo / path).resolve()
    return repo / DEFAULT_FILENAME


def relative_to_repo(repo: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(repo.resolve()).as_posix()
    except ValueError as exc:
        raise SourceMapError(f"SOURCE_MAP.md must be inside the repository: {path}") from exc


def default_base_ref(repo: Path) -> str:
    configured = os.getenv("SOURCE_MAP_BASE_REF", "").strip()
    if configured:
        return configured
    for ref in ("origin/main", "main", "origin/master", "master"):
        if run_git(repo, ["rev-parse", "--verify", "--quiet", ref], check=False).returncode == 0:
            return ref
    raise SourceMapError("Could not detect a base branch. Pass --base explicitly.")


def fetch_base(repo: Path, base_ref: str) -> None:
    if "/" not in base_ref or base_ref.startswith("refs/"):
        raise SourceMapError("--fetch requires a remote-tracking ref such as origin/main.")
    remote, branch = base_ref.split("/", 1)
    run_git(repo, ["fetch", "--prune", remote, branch])


def rev_parse(repo: Path, ref: str) -> str:
    return run_git(repo, ["rev-parse", "--verify", ref]).stdout.strip()


def is_ancestor(repo: Path, ancestor: str, descendant: str) -> bool:
    return run_git(repo, ["merge-base", "--is-ancestor", ancestor, descendant], check=False).returncode == 0


def merge_base(repo: Path, left: str, right: str) -> str:
    return run_git(repo, ["merge-base", left, right]).stdout.strip()


def unmerged_paths(repo: Path) -> list[str]:
    raw = run_git(repo, ["diff", "--name-only", "--diff-filter=U", "-z"], text=False).stdout
    return sorted({part.decode("utf-8", "surrogateescape") for part in raw.split(b"\0") if part})


def stage_text(repo: Path, stage: int, relpath: str) -> str | None:
    proc = run_git(repo, ["show", f":{stage}:{relpath}"], check=False)
    if proc.returncode != 0:
        return None
    return proc.stdout


def encode_state(state: dict[str, Any]) -> str:
    raw = json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"{STATE_PREFIX}{base64.urlsafe_b64encode(raw).decode('ascii')}{STATE_SUFFIX}"


def decode_state(text: str | None) -> dict[str, Any]:
    if not text:
        return {"schema_version": SCHEMA_VERSION, "entries": {}}
    match = STATE_RE.search(text[:20000])
    if not match:
        return {"schema_version": SCHEMA_VERSION, "entries": {}}
    try:
        raw = base64.urlsafe_b64decode(match.group(1).encode("ascii"))
        state = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise SourceMapError("SOURCE_MAP.md contains invalid encoded state.") from exc
    if state.get("schema_version") != SCHEMA_VERSION:
        raise SourceMapError(f"Unsupported SOURCE_MAP state schema: {state.get('schema_version')!r}")
    if not isinstance(state.get("entries"), dict):
        raise SourceMapError("SOURCE_MAP state entries must be an object.")
    return state


def extract_region(text: str | None, start: str, end: str) -> str | None:
    if not text:
        return None
    start_index = text.find(start)
    end_index = text.find(end)
    if start_index < 0 or end_index < 0 or end_index < start_index:
        return None
    body_start = start_index + len(start)
    return text[body_start:end_index].strip("\n")


def default_manual() -> str:
    return "## Architecture Notes\n\nAdd durable architectural context here. Keep generated file details in the auto region."


def has_conflict_markers(text: str) -> bool:
    return bool(CONFLICT_RE.search(text))


def merge_manual(base: str, ours: str, theirs: str) -> tuple[str, bool]:
    with tempfile.TemporaryDirectory(prefix="source-map-manual-") as tmp:
        tmp_path = Path(tmp)
        ours_path = tmp_path / "ours.md"
        base_path = tmp_path / "base.md"
        theirs_path = tmp_path / "theirs.md"
        ours_path.write_text(ours + "\n", encoding="utf-8")
        base_path.write_text(base + "\n", encoding="utf-8")
        theirs_path.write_text(theirs + "\n", encoding="utf-8")
        proc = subprocess.run(
            ["git", "merge-file", "-p", "-L", "current", "-L", "base", "-L", "main", str(ours_path), str(base_path), str(theirs_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if proc.returncode not in (0, 1):
            raise SourceMapError(f"git merge-file failed: {proc.stderr.strip()}")
        return proc.stdout.rstrip("\n"), proc.returncode == 1 or has_conflict_markers(proc.stdout)


def normalize_relpath(value: str) -> str:
    value = value.replace("\\", "/").lstrip("./")
    return PurePosixPath(value).as_posix()


def source_candidate(path: str, extra_extensions: set[str]) -> bool:
    pure = PurePosixPath(path)
    if any(part in IGNORED_DIR_NAMES for part in pure.parts[:-1]):
        return False
    name = pure.name
    suffix = pure.suffix.lower()
    return name in SPECIAL_SOURCE_NAMES or suffix in SOURCE_EXTENSIONS or suffix in extra_extensions


def tracked_paths(repo: Path, include_untracked: bool) -> list[str]:
    args = ["ls-files", "-z", "--cached"]
    if include_untracked:
        args.extend(["--others", "--exclude-standard"])
    raw = run_git(repo, args, text=False).stdout
    return sorted({part.decode("utf-8", "surrogateescape") for part in raw.split(b"\0") if part})


def list_source_files(
    repo: Path,
    source_map_rel: str,
    include_untracked: bool,
    extra_extensions: set[str],
    excludes: Sequence[str],
) -> list[str]:
    import fnmatch

    result: list[str] = []
    for path in tracked_paths(repo, include_untracked):
        path = normalize_relpath(path)
        if path == source_map_rel:
            continue
        if not source_candidate(path, extra_extensions):
            continue
        if any(fnmatch.fnmatch(path, pattern) for pattern in excludes):
            continue
        file_path = repo / path
        if file_path.is_file():
            result.append(path)
    return sorted(set(result))


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_text_sample(path: Path, limit: int = 131072) -> str:
    data = path.read_bytes()[:limit]
    if b"\0" in data:
        return ""
    return data.decode("utf-8", "replace")


def clean_sentence(value: str, limit: int = 180) -> str:
    value = re.sub(r"\s+", " ", value).strip(" -#/*\t\r\n")
    if not value:
        return ""
    if len(value) > limit:
        value = value[: limit - 1].rstrip() + "…"
    if value[-1] not in ".!?。":
        value += "."
    return value


def leading_comment(text: str, suffix: str) -> str:
    if suffix in {".py", ".pyi", ".pyx"}:
        match = re.search(r'\A\s*(?:[rubfRUBF]{0,2})?(?:"{3}|\x27{3})(.*?)(?:"{3}|\x27{3})', text, re.S)
        if match:
            return clean_sentence(match.group(1).split("\n\n", 1)[0])
    block = re.search(r"\A\s*/\*\*?\s*(.*?)\*/", text, re.S)
    if block:
        body = re.sub(r"^\s*\*\s?", "", block.group(1), flags=re.M)
        return clean_sentence(body.split("\n\n", 1)[0])
    lines: list[str] = []
    for line in text.splitlines()[:20]:
        stripped = line.strip()
        if not stripped and not lines:
            continue
        match = re.match(r"(?:#|//|--|;|REM\s+)(.*)", stripped, re.I)
        if match:
            lines.append(match.group(1).strip())
            continue
        break
    return clean_sentence(" ".join(lines))


def extract_symbols(text: str, suffix: str) -> list[str]:
    patterns: list[str]
    if suffix in {".py", ".pyi", ".pyx"}:
        patterns = [r"^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)", r"^\s*class\s+([A-Za-z_]\w*)"]
    elif suffix in {".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"}:
        patterns = [
            r"^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)",
            r"^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)",
            r"^\s*class\s+([A-Za-z_$][\w$]*)",
        ]
    elif suffix in {".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".cs", ".java", ".kt", ".kts", ".swift", ".m", ".mm"}:
        patterns = [
            r"^\s*(?:public|private|protected|internal|static|final|abstract|sealed|partial|virtual|override|constexpr|inline|template\s*<[^>]+>\s*)*\s*(?:class|struct|interface|enum|protocol|record)\s+([A-Za-z_]\w*)",
            r"^\s*(?:public|private|protected|internal|static|final|virtual|override|constexpr|inline|async|extern|friend|synchronized|suspend|fun|func)+[^;{}=]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:\{|=>|$)",
        ]
    elif suffix == ".go":
        patterns = [r"^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)", r"^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)"]
    elif suffix == ".rs":
        patterns = [r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)", r"^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)"]
    elif suffix == ".gd":
        patterns = [r"^\s*func\s+([A-Za-z_]\w*)", r"^\s*class_name\s+([A-Za-z_]\w*)"]
    else:
        patterns = []
    found: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.M):
            name = match.group(1)
            if name not in found:
                found.append(name)
            if len(found) >= 6:
                return found
    return found


def heuristic_summary(path: str, text: str, symbols: Sequence[str]) -> str:
    suffix = PurePosixPath(path).suffix.lower()
    comment = leading_comment(text, suffix)
    if comment:
        return comment
    name = PurePosixPath(path).name
    lower = path.lower()
    symbol_text = ", ".join(f"`{symbol}`" for symbol in symbols[:3])
    if "/test" in lower or name.lower().startswith(("test_", "tests_")) or name.lower().endswith(("test.py", "tests.cs", "test.cpp", "spec.ts", "spec.js")):
        return clean_sentence(f"Tests behavior implemented by the related module{f', including {symbol_text}' if symbol_text else ''}")
    if symbols:
        return clean_sentence(f"Defines {symbol_text} and related implementation behavior")
    stem = re.sub(r"[_\-.]+", " ", PurePosixPath(path).stem).strip()
    return clean_sentence(f"Implements the {stem} source module")


def md_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("|", "\\|").replace("`", "\\`").replace("\n", " ")


def parse_name_status(raw: str) -> list[Change]:
    result: list[Change] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0]
        code = status[0]
        if code in {"R", "C"} and len(parts) >= 3:
            result.append(Change(status=status, path=normalize_relpath(parts[2]), old_path=normalize_relpath(parts[1])))
        elif len(parts) >= 2:
            result.append(Change(status=status, path=normalize_relpath(parts[1])))
    return result


def collect_changes(repo: Path, base_commit: str, head_commit: str, merge_base_commit: str) -> list[Change]:
    sources: list[list[Change]] = []
    sources.append(parse_name_status(run_git(repo, ["diff", "--name-status", "--find-renames", f"{merge_base_commit}..{head_commit}"]).stdout))
    if base_commit != merge_base_commit:
        sources.append(parse_name_status(run_git(repo, ["diff", "--name-status", "--find-renames", f"{merge_base_commit}..{base_commit}"]).stdout))
    sources.append(parse_name_status(run_git(repo, ["diff", "--cached", "--name-status", "--find-renames"]).stdout))
    sources.append(parse_name_status(run_git(repo, ["diff", "--name-status", "--find-renames"]).stdout))
    merged: dict[tuple[str, str], Change] = {}
    for group in sources:
        for change in group:
            merged[(change.path, change.old_path)] = change
    return sorted(merged.values(), key=lambda item: (item.path, item.old_path, item.status))


def current_text(path: Path) -> str | None:
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8", errors="replace")


def combined_prior_states(repo: Path, source_map_path: Path, source_map_rel: str, conflicted: bool) -> list[dict[str, Any]]:
    states: list[dict[str, Any]] = []
    if conflicted:
        texts = [stage_text(repo, stage, source_map_rel) for stage in (2, 3, 1)]
    else:
        texts = [current_text(source_map_path)]
    for text in texts:
        if not text:
            continue
        try:
            states.append(decode_state(text))
        except SourceMapError:
            # Generated state is disposable. A corrupt or hand-edited state line
            # must not prevent rebuilding from the resolved source tree.
            continue
    return states


def prior_entry_for_hash(states: Sequence[dict[str, Any]], path: str, digest: str) -> dict[str, Any] | None:
    for state in states:
        entry = state.get("entries", {}).get(path)
        if isinstance(entry, dict) and entry.get("hash") == digest and entry.get("summary"):
            return entry
    return None


def load_descriptions(args: argparse.Namespace, repo: Path) -> dict[str, str]:
    descriptions: dict[str, str] = {}
    for item in args.description or []:
        if "=" not in item:
            raise SourceMapError(f"--description must be PATH=SUMMARY: {item!r}")
        path, summary = item.split("=", 1)
        descriptions[normalize_relpath(path)] = clean_sentence(summary)
    if args.descriptions_json:
        json_path = Path(args.descriptions_json).expanduser()
        if not json_path.is_absolute():
            json_path = (Path.cwd() / json_path).resolve()
        try:
            payload = json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SourceMapError(f"Could not read descriptions JSON: {json_path}: {exc}") from exc
        if not isinstance(payload, dict):
            raise SourceMapError("Descriptions JSON must be an object mapping paths to summaries.")
        for path, summary in payload.items():
            if not isinstance(path, str) or not isinstance(summary, str):
                raise SourceMapError("Descriptions JSON keys and values must be strings.")
            descriptions[normalize_relpath(path)] = clean_sentence(summary)
    return {path: summary for path, summary in descriptions.items() if summary}


def build_entries(
    repo: Path,
    files: Sequence[str],
    prior_states: Sequence[dict[str, Any]],
    descriptions: dict[str, str],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    entries: dict[str, dict[str, Any]] = {}
    needs_review: list[str] = []
    for relpath in files:
        path = repo / relpath
        digest = file_hash(path)
        text = read_text_sample(path)
        symbols = extract_symbols(text, path.suffix.lower())
        provided = descriptions.get(relpath)
        prior = prior_entry_for_hash(prior_states, relpath, digest)
        if provided:
            summary = provided
            source = "agent"
        elif prior:
            summary = clean_sentence(str(prior.get("summary", "")))
            source = str(prior.get("source") or "preserved")
            if not symbols and isinstance(prior.get("symbols"), list):
                symbols = [str(value) for value in prior["symbols"]][:6]
        else:
            summary = heuristic_summary(relpath, text, symbols)
            source = "heuristic"
        if source == "heuristic":
            needs_review.append(relpath)
        entries[relpath] = {
            "hash": digest,
            "summary": summary,
            "symbols": symbols[:6],
            "source": source,
        }
    unknown = sorted(set(descriptions) - set(files))
    if unknown:
        raise SourceMapError("Descriptions were supplied for paths outside the source map: " + ", ".join(unknown))
    return entries, needs_review


def render_tree(paths: Sequence[str]) -> str:
    trie: dict[str, Any] = {}
    for path in paths:
        node = trie
        for part in PurePosixPath(path).parts:
            node = node.setdefault(part, {})

    lines: list[str] = ["."]

    def walk(node: dict[str, Any], prefix: str) -> None:
        items = sorted(node.items(), key=lambda item: (bool(item[1]) is False, item[0].lower()))
        for index, (name, child) in enumerate(items):
            last = index == len(items) - 1
            lines.append(prefix + ("└── " if last else "├── ") + name)
            if child:
                walk(child, prefix + ("    " if last else "│   "))

    walk(trie, "")
    return "\n".join(lines)


def status_for_path(changes: Sequence[Change], path: str) -> str:
    statuses: list[str] = []
    for change in changes:
        if change.path == path or change.old_path == path:
            label = change.status
            if change.old_path:
                label += f" from {change.old_path}"
            if label not in statuses:
                statuses.append(label)
    return ", ".join(statuses) if statuses else "—"


def render_document(
    *,
    state: dict[str, Any],
    manual: str,
    base_ref: str,
    base_commit: str,
    head_commit: str,
    merge_base_commit: str,
    integrated: bool,
    in_progress: bool,
    files: Sequence[str],
    entries: dict[str, dict[str, Any]],
    changes: Sequence[Change],
    needs_review: Sequence[str],
) -> str:
    branch = state.get("branch", "")
    lines = [
        encode_state(state),
        "# Source Map",
        "",
        "> Repository source tree and per-file responsibilities. Managed by the `source-map-reconciler` skill.",
        "> Edit only the manual region. Never store secrets or hidden reasoning here.",
        "",
        MANUAL_START,
        manual.rstrip(),
        MANUAL_END,
        "",
        AUTO_START,
        "## Snapshot",
        "",
        f"- **Generated:** {state['generated_at']}",
        f"- **Branch:** `{md_escape(str(branch))}`",
        f"- **HEAD:** `{head_commit[:12]}`",
        f"- **Base reference:** `{md_escape(base_ref)}` (`{base_commit[:12]}`)",
        f"- **Merge base:** `{merge_base_commit[:12]}`",
        f"- **Base integrated:** {'yes' if integrated else 'in progress' if in_progress else 'no'}",
        f"- **Mapped source files:** {len(files)}",
        f"- **Descriptions needing review:** {len(needs_review)}",
        "",
        "## Source Tree",
        "",
        "```text",
        render_tree(files),
        "```",
        "",
        "## File Overview",
        "",
        "| Path | Overview | Key symbols | Git delta |",
        "|---|---|---|---|",
    ]
    for path in files:
        entry = entries[path]
        symbols = ", ".join(f"`{md_escape(symbol)}`" for symbol in entry.get("symbols", [])) or "—"
        review = " _(review)_" if entry.get("source") == "heuristic" else ""
        lines.append(
            f"| `{md_escape(path)}` | {md_escape(entry['summary'])}{review} | {symbols} | {md_escape(status_for_path(changes, path))} |"
        )

    source_changes = [change for change in changes if change.path in set(files) or change.old_path in set(files)]
    lines.extend(["", f"## Git Delta Against `{md_escape(base_ref)}`", ""])
    if source_changes:
        lines.extend(["| Status | Path |", "|---|---|"])
        for change in source_changes:
            if change.old_path:
                path_text = f"`{md_escape(change.old_path)}` → `{md_escape(change.path)}`"
            else:
                path_text = f"`{md_escape(change.path)}`"
            lines.append(f"| `{md_escape(change.status)}` | {path_text} |")
    else:
        lines.append("_No source changes detected against the merge base or working tree._")

    lines.extend(["", "## Description Review Queue", ""])
    if needs_review:
        for path in needs_review:
            lines.append(f"- `{md_escape(path)}`")
    else:
        lines.append("_All descriptions are tied to an unchanged file hash or were supplied during this update._")

    lines.extend(["", AUTO_END, ""])
    return "\n".join(lines)


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent), text=True)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        temp_path.unlink(missing_ok=True)


def resolve_manual_for_update(
    repo: Path,
    source_map_path: Path,
    source_map_rel: str,
    conflicted: bool,
    accept_working_manual: bool,
) -> tuple[str, bool]:
    working = current_text(source_map_path)
    if accept_working_manual:
        manual = extract_region(working, MANUAL_START, MANUAL_END)
        if manual is None:
            raise SourceMapError("The working SOURCE_MAP.md has no valid manual region.")
        if has_conflict_markers(manual):
            raise SourceMapError("Resolve all conflict markers in the manual region before using --accept-working-manual.")
        return manual, False

    if not conflicted:
        manual = extract_region(working, MANUAL_START, MANUAL_END)
        return (manual if manual is not None else default_manual()), False

    base_text = stage_text(repo, 1, source_map_rel)
    ours_text = stage_text(repo, 2, source_map_rel)
    theirs_text = stage_text(repo, 3, source_map_rel)
    base = extract_region(base_text, MANUAL_START, MANUAL_END) or default_manual()
    ours = extract_region(ours_text, MANUAL_START, MANUAL_END) or base
    theirs = extract_region(theirs_text, MANUAL_START, MANUAL_END) or base
    return merge_manual(base, ours, theirs)


def extension_set(values: Sequence[str]) -> set[str]:
    result: set[str] = set()
    for value in values:
        value = value.strip().lower()
        if not value:
            continue
        result.add(value if value.startswith(".") else f".{value}")
    return result


def prepare_context(args: argparse.Namespace) -> dict[str, Any]:
    repo = repo_root(Path.cwd())
    output_path = resolve_output_path(repo, args.file)
    output_rel = relative_to_repo(repo, output_path)
    base_ref = args.base or default_base_ref(repo)
    if getattr(args, "fetch", False):
        fetch_base(repo, base_ref)
    base_commit = rev_parse(repo, base_ref)
    head_commit = rev_parse(repo, "HEAD")
    merge_base_commit = merge_base(repo, head_commit, base_commit)
    integrated = is_ancestor(repo, base_commit, head_commit)
    in_progress = operation_in_progress(repo)
    unmerged = unmerged_paths(repo)
    conflicted = output_rel in unmerged
    other_unmerged = [path for path in unmerged if path != output_rel]
    files = list_source_files(
        repo,
        output_rel,
        not getattr(args, "tracked_only", False),
        extension_set(getattr(args, "include_extension", []) or []),
        getattr(args, "exclude", []) or [],
    )
    changes = collect_changes(repo, base_commit, head_commit, merge_base_commit)
    return {
        "repo": repo,
        "output_path": output_path,
        "output_rel": output_rel,
        "base_ref": base_ref,
        "base_commit": base_commit,
        "head_commit": head_commit,
        "merge_base_commit": merge_base_commit,
        "integrated": integrated,
        "in_progress": in_progress,
        "unmerged": unmerged,
        "conflicted": conflicted,
        "other_unmerged": other_unmerged,
        "files": files,
        "changes": changes,
    }


def command_plan(args: argparse.Namespace) -> int:
    ctx = prepare_context(args)
    states = combined_prior_states(ctx["repo"], ctx["output_path"], ctx["output_rel"], ctx["conflicted"])
    entries, needs_review = build_entries(ctx["repo"], ctx["files"], states, {})
    payload = {
        "repository": str(ctx["repo"]),
        "source_map": ctx["output_rel"],
        "base_ref": ctx["base_ref"],
        "base_commit": ctx["base_commit"],
        "head_commit": ctx["head_commit"],
        "merge_base": ctx["merge_base_commit"],
        "base_integrated": ctx["integrated"],
        "integration_in_progress": ctx["in_progress"],
        "source_map_conflicted": ctx["conflicted"],
        "other_unmerged": ctx["other_unmerged"],
        "source_files": ctx["files"],
        "needs_review": needs_review,
        "heuristic_previews": {path: entries[path]["summary"] for path in needs_review},
        "changes": [change.__dict__ for change in ctx["changes"]],
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(f"Repository: {ctx['repo']}")
        print(f"Source map: {ctx['output_rel']}")
        print(f"Base: {ctx['base_ref']} ({ctx['base_commit'][:12]})")
        print(f"Base integrated: {ctx['integrated']} (operation in progress: {ctx['in_progress']})")
        print(f"Source map conflicted: {ctx['conflicted']}")
        print(f"Other unmerged paths: {len(ctx['other_unmerged'])}")
        for path in ctx["other_unmerged"]:
            print(f"  - {path}")
        print(f"Mapped source files: {len(ctx['files'])}")
        print(f"Descriptions needing review: {len(needs_review)}")
        for path in needs_review:
            print(f"  - {path}: {entries[path]['summary']}")
    return 0


def command_update(args: argparse.Namespace) -> int:
    ctx = prepare_context(args)
    if ctx["other_unmerged"]:
        raise SourceMapError(
            "Resolve all non-SOURCE_MAP.md conflicts before regeneration: " + ", ".join(ctx["other_unmerged"])
        )
    if not ctx["integrated"] and not ctx["in_progress"] and not args.allow_diverged:
        raise SourceMapError(
            f"{ctx['base_ref']} is not integrated into HEAD. Merge or rebase according to repository policy, "
            "or pass --allow-diverged for an intentionally branch-only snapshot."
        )

    descriptions = load_descriptions(args, ctx["repo"])
    prior_states = combined_prior_states(ctx["repo"], ctx["output_path"], ctx["output_rel"], ctx["conflicted"])
    entries, needs_review = build_entries(ctx["repo"], ctx["files"], prior_states, descriptions)
    manual, manual_conflicted = resolve_manual_for_update(
        ctx["repo"],
        ctx["output_path"],
        ctx["output_rel"],
        ctx["conflicted"],
        args.accept_working_manual,
    )
    branch = run_git(ctx["repo"], ["branch", "--show-current"], check=False).stdout.strip() or "(detached HEAD)"
    state = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_iso(),
        "base_ref": ctx["base_ref"],
        "base_commit": ctx["base_commit"],
        "head_commit": ctx["head_commit"],
        "merge_base": ctx["merge_base_commit"],
        "branch": branch,
        "entries": entries,
    }
    document = render_document(
        state=state,
        manual=manual,
        base_ref=ctx["base_ref"],
        base_commit=ctx["base_commit"],
        head_commit=ctx["head_commit"],
        merge_base_commit=ctx["merge_base_commit"],
        integrated=ctx["integrated"],
        in_progress=ctx["in_progress"],
        files=ctx["files"],
        entries=entries,
        changes=ctx["changes"],
        needs_review=needs_review,
    )
    atomic_write(ctx["output_path"], document)

    if manual_conflicted:
        print(
            "Manual-region conflict remains. Resolve markers inside the manual block, then rerun update "
            "with --accept-working-manual.",
            file=sys.stderr,
        )
        return MANUAL_CONFLICT_EXIT

    should_stage = args.stage or ctx["conflicted"]
    if should_stage:
        run_git(ctx["repo"], ["add", "--", ctx["output_rel"]])

    print(f"Updated: {ctx['output_path']}")
    print(f"Mapped source files: {len(ctx['files'])}")
    print(f"Descriptions needing review: {len(needs_review)}")
    if should_stage:
        print(f"Staged: {ctx['output_rel']}")
    return 0


def command_verify(args: argparse.Namespace) -> int:
    ctx = prepare_context(args)
    if ctx["unmerged"]:
        raise SourceMapError("Unmerged paths remain: " + ", ".join(ctx["unmerged"]))
    text = current_text(ctx["output_path"])
    if text is None:
        raise SourceMapError(f"Missing source map: {ctx['output_path']}")
    for marker in (MANUAL_START, MANUAL_END, AUTO_START, AUTO_END):
        if text.count(marker) != 1:
            raise SourceMapError(f"Expected exactly one marker: {marker}")
    if has_conflict_markers(text):
        raise SourceMapError("Conflict markers remain in SOURCE_MAP.md.")
    state = decode_state(text)
    entries = state.get("entries", {})
    expected = set(ctx["files"])
    actual = set(entries)
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    mismatched: list[str] = []
    heuristic: list[str] = []
    for path in sorted(expected & actual):
        entry = entries[path]
        if entry.get("hash") != file_hash(ctx["repo"] / path):
            mismatched.append(path)
        if entry.get("source") == "heuristic":
            heuristic.append(path)
    if missing or extra or mismatched:
        details: list[str] = []
        if missing:
            details.append("missing=" + ", ".join(missing))
        if extra:
            details.append("extra=" + ", ".join(extra))
        if mismatched:
            details.append("hash-mismatch=" + ", ".join(mismatched))
        raise SourceMapError("SOURCE_MAP.md is stale: " + "; ".join(details))
    if args.require_reviewed and heuristic:
        raise SourceMapError("Heuristic descriptions still need review: " + ", ".join(heuristic))
    if not ctx["integrated"] and not ctx["in_progress"] and not args.allow_diverged:
        raise SourceMapError(f"{ctx['base_ref']} is not integrated into HEAD.")
    print(f"Verified: {ctx['output_path']}")
    print(f"Mapped source files: {len(expected)}")
    print(f"Heuristic descriptions: {len(heuristic)}")
    return 0


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--file", help="SOURCE_MAP.md path; defaults to repository root.")
    parser.add_argument("--base", help="Integration branch/ref; defaults to origin/main, main, origin/master, or master.")
    parser.add_argument("--fetch", action="store_true", help="Fetch the named remote branch before planning or updating.")
    parser.add_argument("--tracked-only", action="store_true", help="Exclude untracked source files from the map.")
    parser.add_argument("--include-extension", action="append", default=[], help="Additional source extension, with or without a leading dot.")
    parser.add_argument("--exclude", action="append", default=[], help="Additional repository-relative glob to exclude.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Maintain a main-aware source tree and per-file overview in SOURCE_MAP.md.")
    sub = parser.add_subparsers(dest="command", required=True)

    plan = sub.add_parser("plan", help="Inspect Git state and list files whose descriptions need review.")
    add_common(plan)
    plan.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")

    update = sub.add_parser("update", help="Regenerate SOURCE_MAP.md and reconcile a document conflict.")
    add_common(update)
    update.add_argument("--description", action="append", default=[], metavar="PATH=SUMMARY")
    update.add_argument("--descriptions-json", help="JSON object mapping repository paths to summaries.")
    update.add_argument("--accept-working-manual", action="store_true", help="Use the conflict-free manual region currently in SOURCE_MAP.md.")
    update.add_argument("--stage", action="store_true", help="Stage SOURCE_MAP.md after successful generation.")
    update.add_argument("--allow-diverged", action="store_true", help="Allow a branch-only snapshot before the base is integrated.")

    verify = sub.add_parser("verify", help="Verify markers, file membership, hashes, and integration state.")
    add_common(verify)
    verify.add_argument("--require-reviewed", action="store_true", help="Fail if any description is still heuristic.")
    verify.add_argument("--allow-diverged", action="store_true", help="Allow verification before the base is integrated.")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "plan":
            return command_plan(args)
        if args.command == "update":
            return command_update(args)
        if args.command == "verify":
            return command_verify(args)
        parser.error(f"Unknown command: {args.command}")
    except SourceMapError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("error: interrupted", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
