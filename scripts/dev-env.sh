#!/usr/bin/env bash
# Source from the repository root. No .env or 1Password required.
# Full directory identity separates clones/worktrees even when their basenames match.
dev_identity=$(printf '%s' "$PWD" | cksum | awk '{print $1}')
dev_name=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-banbanyeok-${dev_name}-${dev_identity}}"
export DB_PORT="${DB_PORT:-$((20000 + dev_identity % 10000))}"
export SERVER_PORT="${SERVER_PORT:-$((30000 + dev_identity % 10000))}"
export WEB_PORT="${WEB_PORT:-$((40000 + dev_identity % 10000))}"
