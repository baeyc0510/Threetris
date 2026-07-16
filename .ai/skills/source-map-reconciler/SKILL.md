---
name: source-map-reconciler
description: Create and maintain a repository-level SOURCE_MAP.md containing a source tree and per-file overviews. Use after source changes, before handoff, and while resolving merge or rebase conflicts with main. Reconcile generated content from the resolved worktree instead of choosing ours or theirs for the whole Markdown file.
---

# Source map reconciler

Maintain one repository-level `SOURCE_MAP.md` that describes the current source tree and the role of each source file.

The document has two regions:

- a **manual region** for architecture notes and human-authored context,
- an **auto region** for the source tree, file table, symbols, hashes, and Git delta.

Never resolve a `SOURCE_MAP.md` conflict by accepting the entire `ours` or `theirs` version. The merged source tree is the source of truth for the auto region.

## Resolve the script

The canonical project installation path is:

```bash
python3 .ai/skills/source-map-reconciler/scripts/source_map.py
```

Claude Code may also use:

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/source_map.py"
```

For Codex or another Agent Skills client, resolve `scripts/source_map.py` relative to this `SKILL.md` if the canonical path is unavailable.

Set a different document path with `SOURCE_MAP_FILE` or `--file`.
Set the integration branch with `SOURCE_MAP_BASE_REF` or `--base`.

## Normal update workflow

1. Read repository instructions and determine whether the project integrates `main` by merge, rebase, or another documented policy.
2. Fetch the base reference when network access is allowed.
3. Run `plan` before editing `SOURCE_MAP.md`.
4. If the base reference is not integrated, integrate it according to repository policy. Do not silently choose merge versus rebase.
5. Resolve source-code conflicts first.
6. Read every file reported in `needs_review` and prepare concise descriptions.
7. Regenerate the document and verify it.
8. Record the result in `WORKSPACE_STATUS.md` when the coordination skill is installed.

```bash
SCRIPT=.ai/skills/source-map-reconciler/scripts/source_map.py

python3 "$SCRIPT" plan --base origin/main --fetch --json > /tmp/source-map-plan.json
```

Prepare a temporary UTF-8 JSON object whose keys are repository-relative paths and whose values are one-sentence descriptions:

```json
{
  "src/auth/token.py": "Issues, validates, and rotates access and refresh tokens.",
  "tests/auth/test_token.py": "Covers token expiry, rotation, and replay rejection behavior."
}
```

Then update and verify:

```bash
python3 "$SCRIPT" update \
  --base origin/main \
  --descriptions-json /tmp/source-map-descriptions.json \
  --stage

python3 "$SCRIPT" verify --base origin/main
rm -f /tmp/source-map-plan.json /tmp/source-map-descriptions.json
```

`--stage` stages only `SOURCE_MAP.md`. It does not stage source files.

## Merge and rebase conflicts

First list all unresolved paths:

```bash
python3 "$SCRIPT" plan --base origin/main --json
```

If any file other than `SOURCE_MAP.md` is unmerged, resolve those files first and rerun tests. The script deliberately refuses to generate a map from an unresolved source tree.

When `SOURCE_MAP.md` is the only unresolved path, run `update` normally. The script:

1. reads the base, ours, and theirs versions from Git's index,
2. 3-way merges only the manual region,
3. discards both conflicting auto regions,
4. rebuilds the auto region from the resolved worktree,
5. stages `SOURCE_MAP.md` when reconciliation succeeds.

```bash
python3 "$SCRIPT" update \
  --base origin/main \
  --descriptions-json /tmp/source-map-descriptions.json \
  --stage
```

If the manual region has overlapping edits, the command exits with code `3` and writes conflict markers only inside the manual region. Resolve those markers semantically:

- preserve compatible notes from both sides,
- remove stale statements contradicted by the merged source,
- do not edit the auto region,
- do not leave conflict markers.

Then rerun:

```bash
python3 "$SCRIPT" update \
  --base origin/main \
  --accept-working-manual \
  --descriptions-json /tmp/source-map-descriptions.json \
  --stage

python3 "$SCRIPT" verify --base origin/main
```

## Description rules

Each file overview should state responsibility, not restate the filename.

Good:

- `Coordinates fixed-step simulation and dispatches gameplay-system updates.`
- `Defines the save-game schema and backward-compatible migration helpers.`
- `Tests reconnect behavior after lobby host migration.`

Avoid:

- `Contains code for manager.`
- implementation details likely to become stale,
- large symbol inventories,
- secrets, credentials, private endpoints, or copied payloads.

The script preserves a description only while the file hash is unchanged. Changed files are reported in `needs_review`. Without an agent-provided description, the script creates a conservative heuristic summary and marks it for review.

## Main-awareness rules

- Prefer `origin/main` when it exists; otherwise use the repository's configured base.
- `update` refuses to claim a main-aware result when the base is neither an ancestor of `HEAD` nor currently being integrated, unless `--allow-diverged` is explicitly supplied.
- `--fetch` only refreshes the named remote branch. It never merges or rebases.
- During an active merge or rebase, regenerate only after all source conflicts are resolved.
- After updating, `verify` must report no conflict markers, no missing or extra source entries, and matching file hashes.

## Coordination log

When the workspace coordination skill exists, record a concise change note:

```bash
STATUS=.ai/skills/workspace-coordination/scripts/workspace_status.py
python3 "$STATUS" --agent "${WORKSPACE_AGENT:-source-map-agent}" note \
  --kind change \
  --message "Reconciled SOURCE_MAP.md with origin/main and the resolved source tree; verified file entries and hashes."
```

Do not fail the source-map task merely because the optional coordination logger is absent.
