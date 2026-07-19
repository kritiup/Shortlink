#!/usr/bin/env bash
# CVE-scan every image. Uses `docker scout` if available, else `trivy`.
set -euo pipefail
REGISTRY="${1:-docker.io/yourname}"
TAG="${2:-v1}"
IMAGES=(shortlink-web shortlink-api shortlink-redirect shortlink-analytics)

have_scout() { docker scout version >/dev/null 2>&1; }

scan_one() {
  local img="$1"
  echo "=================================================================="
  echo "  scanning $img"
  echo "=================================================================="
  if have_scout; then
    docker scout cves --only-severity critical,high "$img" || true
  elif command -v trivy >/dev/null 2>&1; then
    trivy image --severity CRITICAL,HIGH --ignore-unfixed "$img" || true
  else
    echo "No scanner found. Install Docker Scout (bundled with recent Docker)"
    echo "or trivy: https://aquasecurity.github.io/trivy/"
    return 0
  fi
}

for i in "${IMAGES[@]}"; do scan_one "$REGISTRY/$i:$TAG"; done
