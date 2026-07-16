# Agent Instructions

## Source of truth

* Read `3D_Tetris_GDD.md` before planning or implementation.
* Treat it as the authority for game identity, rules, visuals, and acceptance criteria.
* Ask the user only when required information is missing. Otherwise, make a concise plan and begin.

## Before starting work

1. Use the `workspace-coordination` skill.
2. Read `WORKSPACE_STATUS.md`, check active ownership, and register the task and scope.
3. Read `SOURCE_MAP.md`. When it is missing, stale, or affected by `main` changes, use the `source-map-reconciler` skill before editing.
4. Do not modify files owned by another active task without an explicit handoff.

## Implementation rules

* Use Vite, TypeScript, Three.js, and HTML/CSS overlays.
* Keep integer-grid game logic separate from rendering.
* Preserve clear responsibilities such as `Board`, `Piece`, `GameManager`, `Renderer`, `Input`, and `UI`.
* Record meaningful progress, decisions, blockers, and test results with `workspace-coordination`.

## Before `git push`

1. Update from `origin/main` according to the repository's merge or rebase policy.
2. Resolve all source-code conflicts first.
3. Use `source-map-reconciler` to reconcile, update, and verify `SOURCE_MAP.md`.

   * Regenerate its automatic section from the resolved source tree.
   * Preserve and merge manual notes.
   * Do not push with conflict markers or verification failures.
4. Run the relevant tests and `npm run build`.
5. Use `workspace-coordination` to record changed scope, verification results, remaining work, and completion or handoff.
6. Push only when the working tree and required checks are clean.
