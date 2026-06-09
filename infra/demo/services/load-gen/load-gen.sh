#!/bin/bash
# Load generator — hits demo services every 500ms, varies rate every 30s
SERVICES=("http://payments-api:3010/pay" "http://auth-service:3011/login" "http://checkout-api:3012/checkout")
DELAY=0.5

echo '{"level":"info","msg":"load-gen started","services":3}'

while true; do
  # Vary rate every 30s
  if [ $((RANDOM % 30)) -eq 0 ]; then
    DELAY=$(awk "BEGIN {print 0.1 + rand() * 1.5}")
    echo "{\"level\":\"info\",\"msg\":\"rate change\",\"delay\":$DELAY}"
  fi

  TARGET=${SERVICES[$((RANDOM % 3))]}

  case "$TARGET" in
    *pay*)   curl -s -X POST "$TARGET" -H 'Content-Type: application/json' -d '{"amount":25.99}' -o /dev/null -w '' ;;
    *login*) curl -s -X POST "$TARGET" -H 'Content-Type: application/json' -d '{"email":"user@demo.com"}' -o /dev/null -w '' ;;
    *checkout*) curl -s -X POST "$TARGET" -H 'Content-Type: application/json' -d '{"items":[{"id":"prod-1","qty":1}]}' -o /dev/null -w '' ;;
  esac

  sleep "$DELAY"
done
