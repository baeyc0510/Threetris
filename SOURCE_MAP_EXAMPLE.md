# Source-map conflict example

```bash
SCRIPT=.ai/skills/source-map-reconciler/scripts/source_map.py

# Refresh main, then integrate it using the repository's normal policy.
git fetch origin main
git merge origin/main

# Resolve source files first. SOURCE_MAP.md may remain unmerged.
python3 "$SCRIPT" plan --base origin/main --json

# Read all paths in needs_review and prepare descriptions.
cat >/tmp/source-map-descriptions.json <<'JSON'
{
  "src/network/LobbyClient.cpp": "Maintains lobby membership and reconnect state for online sessions.",
  "src/network/LobbyClient.h": "Declares the lobby client API and connection-state model."
}
JSON

# Auto-generated conflicts are discarded and rebuilt from the resolved worktree.
python3 "$SCRIPT" update \
  --base origin/main \
  --descriptions-json /tmp/source-map-descriptions.json \
  --stage

# If exit code 3 occurs, resolve only the manual-region markers and rerun:
python3 "$SCRIPT" update \
  --base origin/main \
  --accept-working-manual \
  --descriptions-json /tmp/source-map-descriptions.json \
  --stage

python3 "$SCRIPT" verify --base origin/main
```
