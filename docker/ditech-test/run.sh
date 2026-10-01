#!/usr/bin/env bash
# Copies the committed source (git HEAD) into the ditech-fork-src volume and
# runs the tests (see docker-compose.yml).   run.sh [all|unit|e2e] [pattern]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
mode="${1:-all}"
pattern="${2:-}"

docker volume create ditech-fork-src >/dev/null
# Fresh source, keeping node_modules (pnpm reinstalls only what changed).
git -C "$repo" archive --format=tar HEAD | docker run --rm -i -v ditech-fork-src:/src node:18.16.1-bookworm \
  bash -c 'find /src -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + && tar xf - -C /src'
mkdir -p "$here/out"

compose=(docker compose -f "$here/docker-compose.yml")
trap '"${compose[@]}" down -v --remove-orphans >/dev/null 2>&1' EXIT
"${compose[@]}" run --rm -e MODE="$mode" -e PATTERN="$pattern" runner
