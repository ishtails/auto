#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f "package.json" ]]; then
	echo "Error: package.json not found. Run this script from repo root."
	exit 1
fi

echo "Removing all node_modules directories..."
find . -type d -name node_modules -prune -exec rm -rf {} +

echo "Removing bun lockfiles..."
find . -type f -name bun.lock -delete

echo "Running fresh install..."
bun install

echo "Done."
