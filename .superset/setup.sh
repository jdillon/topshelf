#!/usr/bin/env bash
set -euo pipefail

# Superset workspace setup — moon manages bun and dependencies
moon run :typecheck
moon run :lint
