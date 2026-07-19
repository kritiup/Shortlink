#!/usr/bin/env bash
# End-to-end check: create a link, visit it a few times, read the click count.
set -euo pipefail
BASE="${1:-http://localhost:8080}"

echo "1) creating a short link..."
resp=$(curl -fsS -X POST "$BASE/api/links" \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.docker.com"}')
echo "   $resp"
code=$(printf '%s' "$resp" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
[ -n "$code" ] || { echo "could not parse code"; exit 1; }

echo "2) visiting /r/$code three times..."
for _ in 1 2 3; do
  curl -fsS -o /dev/null -w "   -> %{http_code} (redirect)\n" "$BASE/r/$code"
done

echo "3) giving the analytics worker a moment, then reading stats..."
sleep 2
curl -fsS "$BASE/api/links/$code/stats"; echo
