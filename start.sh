#!/usr/bin/env bash
set -euo pipefail
PORT="${1:-3001}"
npm run dev -- --port "$PORT"
