#!/usr/bin/env bash
# Build every image with buildx and push it to the registry, attaching an
# SBOM and provenance (SLSA) attestation to each. Requires `docker login`.
set -euo pipefail
REGISTRY="${1:?usage: build-and-push.sh REGISTRY TAG}"
TAG="${2:?usage: build-and-push.sh REGISTRY TAG}"

# image name -> build context directory
build() {
  local name="$1" ctx="$2"
  echo "== build + push $REGISTRY/$name:$TAG =="
  docker buildx build \
    --sbom=true --provenance=true \
    -t "$REGISTRY/$name:$TAG" \
    --push "./$ctx"
}

build shortlink-web       web
build shortlink-api       api
build shortlink-redirect  redirect
build shortlink-analytics analytics
echo "all images pushed to $REGISTRY (tag $TAG)"
