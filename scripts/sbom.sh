#!/usr/bin/env bash
# Generate a Software Bill of Materials (SBOM) per image, using syft.
set -euo pipefail
REGISTRY="${1:-docker.io/yourname}"
TAG="${2:-v1}"
IMAGES=(shortlink-web shortlink-api shortlink-redirect shortlink-analytics)

if ! command -v syft >/dev/null 2>&1; then
  echo "syft not found. Install: https://github.com/anchore/syft"
  echo "  (docker build --sbom=true also attaches an SBOM at build time)"
  exit 1
fi

mkdir -p sboms
for i in "${IMAGES[@]}"; do
  echo "== SBOM for $i =="
  syft "$REGISTRY/$i:$TAG" -o spdx-json > "sboms/$i.spdx.json"
  # a quick human-readable count of packages found
  syft "$REGISTRY/$i:$TAG" -o table | tail -n +1 | wc -l | xargs echo "  packages:"
done
echo "SBOMs written to ./sboms/"
