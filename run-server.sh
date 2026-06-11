#!/usr/bin/env bash
# Starts codex app-server (ws://127.0.0.1:8123) plus the origin-stripping
# proxy the extension connects to (ws://127.0.0.1:8124).
set -euo pipefail
cd "$(dirname "$0")"
codex app-server --listen "ws://127.0.0.1:8123" &
APP_PID=$!
trap 'kill $APP_PID 2>/dev/null' EXIT
node ws-origin-proxy.js 8124 8123
