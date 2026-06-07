#!/usr/bin/env bash
# Watches BRIDGE.md for new CLAUDE [OPEN] entries and invokes opencode to reply.
# Run once in a persistent terminal: bash scripts/bridge-watch.sh
set -euo pipefail

OPENCODE="/Users/raj/.opencode/bin/opencode"
BRANCH="claude/claude-md-docs-k210H"
REPO_DIR="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
CURSOR_FILE="$REPO_DIR/.codex-bridge-cursor"

echo "[bridge-watch] starting — polling every 30s on branch $BRANCH"

while true; do
  cd "$REPO_DIR"

  git fetch origin "$BRANCH" --quiet 2>/dev/null || true
  git merge "origin/$BRANCH" --ff-only --quiet 2>/dev/null || true

  LATEST=$(git log --format="%H" -1 -- docs/BRIDGE.md 2>/dev/null || echo "")
  LAST=$(cat "$CURSOR_FILE" 2>/dev/null || echo "")

  if [ "$LATEST" != "$LAST" ] && [ -n "$LATEST" ]; then
    if grep -q "\[OPEN\]" docs/BRIDGE.md 2>/dev/null; then
      echo "[bridge-watch] new CLAUDE [OPEN] detected at $LATEST — invoking opencode"
      echo "$LATEST" > "$CURSOR_FILE"

      AGENT_PROMPT=$(cat "$REPO_DIR/docs/CODEX-AGENT-PROMPT.md")
      "$OPENCODE" run "$AGENT_PROMPT"

      echo "[bridge-watch] opencode run complete"
    else
      # New commit but no [OPEN] — just update cursor
      echo "[bridge-watch] new commit $LATEST but no [OPEN] entries — cursor updated"
      echo "$LATEST" > "$CURSOR_FILE"
    fi
  fi

  sleep 30
done
