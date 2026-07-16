# SOURCE_MAP.md format

The generated document uses stable marker blocks:

```md
<!-- source-map-state:v1:... -->
# Source Map

<!-- source-map:manual:start -->
## Architecture Notes

Human-authored context lives here.
<!-- source-map:manual:end -->

<!-- source-map:auto:start -->
Generated tree, file overview, and Git delta.
<!-- source-map:auto:end -->
```

Only the manual region should be edited by hand. The state comment and auto region are replaced by the script.

During a Git conflict, the script merges the three manual regions using the index stages and regenerates the auto region from the worktree. If the manual 3-way merge is ambiguous, the working document contains conflict markers only in the manual block until an agent resolves them and reruns `update --accept-working-manual`.
