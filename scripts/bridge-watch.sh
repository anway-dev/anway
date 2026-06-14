#!/usr/bin/env bash
# Watches BRIDGE.md for new CLAUDE [OPEN] entries and invokes opencode to reply.
# Run once in a persistent terminal: bash scripts/bridge-watch.sh
set -uo pipefail

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
    # Only trigger on header lines: ## CLAUDE — ... | TASKS [OPEN]
    # Body text may mention "TASKS [OPEN]" in descriptions — must not trigger.
    if grep -q "^## CLAUDE.*TASKS \[OPEN\]" docs/BRIDGE.md 2>/dev/null; then
      echo "[bridge-watch] new CLAUDE TASKS [OPEN] detected at $LATEST — invoking opencode"
      echo "$LATEST" > "$CURSOR_FILE"

      # Extract only the MOST RECENT TASKS [OPEN] block (header → next ## section header)
      # Terminates on next ## line so --- dividers within the task body are preserved.
      OPEN_ENTRY=$(awk '
        /^## CLAUDE.*TASKS \[OPEN\]/ { block=$0"\n"; in_block=1; next }
        in_block && /^## /           { last=block; in_block=0; block="" }
        in_block                     { block=block $0"\n" }
        END                          { if(in_block) last=block; print last }
      ' docs/BRIDGE.md)
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

      if "$OPENCODE" run --model deepseek/deepseek-v4-pro "$PROMPT"; then
        echo "[bridge-watch] opencode run complete"
      else
        echo "[bridge-watch] opencode exited non-zero — will retry on next commit"
        # Reset cursor so next poll retries the same [OPEN] entry
        rm -f "$CURSOR_FILE"
      fi
    else
      echo "[bridge-watch] new commit $LATEST but no TASKS [OPEN] entries — cursor updated"
      echo "$LATEST" > "$CURSOR_FILE"
    fi
  fi

  sleep 30
done
