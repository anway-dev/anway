#!/bin/bash
# Chaos injector — kills services and creates commits
SERVICES=("payments-api" "auth-service" "checkout-api")
GITEA_URL="http://gitea:3000"
GITEA_TOKEN="demo-token-gitea-anvay"

echo '{"level":"info","msg":"chaos injector started"}'

while true; do
  SLEEP=$((120 + RANDOM % 180))
  sleep "$SLEEP"

  # Pick a service and kill it
  TARGET=${SERVICES[$((RANDOM % 3))]}
  CONTAINER=$(docker ps --filter "name=$TARGET" --format "{{.ID}}" 2>/dev/null | head -1)
  if [ -n "$CONTAINER" ]; then
    docker kill "$CONTAINER" 2>/dev/null
    echo "{\"level\":\"warn\",\"msg\":\"killed\",\"service\":\"$TARGET\"}"
  fi

  # Every 300s: commit to Gitea repo
  if [ $((RANDOM % 3)) -eq 0 ]; then
    git clone "http://anvay:anvaypassword@gitea:3000/demo-org/payments" /tmp/payments-repo 2>/dev/null
    cd /tmp/payments-repo || continue
    echo "$(date -u +%s) - deploy $(openssl rand -hex 4)" >> deploy.log
    git add deploy.log
    git -c user.name=chaos -c user.email=chaos@demo.com commit -m "deploy: automated deploy $(date -u +%Y%m%d%H%M%S)"
    git push "http://anvay:anvaypassword@gitea:3000/demo-org/payments" main -q 2>/dev/null
    rm -rf /tmp/payments-repo
    echo '{"level":"info","msg":"gitea commit pushed"}'
  fi
done
