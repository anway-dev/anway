#!/usr/bin/env bash
# review-watcher.sh — watches logs/build/review-trigger for task completions
# Emits one line per completed task: "TASK_COMPLETE: <task-id>"
# Claude Code monitors this process via the Monitor tool and runs a review on each line.
#
# Usage: ./scripts/review-watcher.sh
# Keep running alongside the build. Kill with Ctrl-C.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIGGER_FILE="$REPO_ROOT/logs/build/review-trigger"

mkdir -p "$REPO_ROOT/logs/build"

last_task=""

echo "[watcher] started — watching $TRIGGER_FILE"

while true; do
  if [[ -f "$TRIGGER_FILE" ]]; then
    task=$(cat "$TRIGGER_FILE")
    if [[ -n "$task" && "$task" != "$last_task" ]]; then
      echo "TASK_COMPLETE: $task"
      last_task="$task"
    fi
  fi
  sleep 3
done
