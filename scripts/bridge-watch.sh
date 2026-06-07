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

      # Compose prompt from live authoritative sources — no static copy
      OPEN_ENTRY=$(awk '/\[OPEN\]/{found=1} found{print} /^---$/ && found{exit}' docs/BRIDGE.md)
      PROMPT="You are Codex, executor agent for this project.

Read CLAUDE.md for architecture, non-negotiables, and design decisions.
Read docs/BRIDGE.md for the full communication log.

The most recent CLAUDE entry marked [OPEN] is your task:

$OPEN_ENTRY

Execute it. When done:
1. Append a CODEX STATUS entry to docs/BRIDGE.md:
   ## CODEX — $(date '+%Y-%m-%d %H:%M') | STATUS [ANSWERED]
   <summary of what you did>
   ---
2. git add docs/BRIDGE.md && git commit -m 'bridge: Codex reply — <one line>' && git push
3. Stop."

      "$OPENCODE" run "$PROMPT"
      echo "[bridge-watch] opencode run complete"
    else
      echo "[bridge-watch] new commit $LATEST but no [OPEN] entries — cursor updated"
      echo "$LATEST" > "$CURSOR_FILE"
    fi
  fi

  sleep 30
done
