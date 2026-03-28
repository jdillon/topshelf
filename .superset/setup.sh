#!/usr/bin/env bash
set -euo pipefail

# Superset workspace setup script
echo "Installing dependencies..."
bun install

echo "Running typecheck..."
moon run :typecheck
