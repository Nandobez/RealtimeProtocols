#!/usr/bin/env bash
#
# RealtimeProtocols — one-shot launcher.
#
# Boots:
#   1. Node server (SSE / Long Polling / WebSocket)  → http://localhost:9090
#   2. Python aioquic sidecar (WebTransport / HTTP/3) → udp://localhost:4444/wt
#
# Generates a TLS cert on first run.  When this script is interrupted
# (Ctrl+C) or its terminal closes, both child processes are killed too.
#
# Usage: ./run.sh [--port 9090] [--wt-port 4444]

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PORT="${PORT:-9090}"
WT_PORT="${WT_PORT:-4444}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)     PORT="$2";    shift 2 ;;
    --wt-port)  WT_PORT="$2"; shift 2 ;;
    *) echo "unknown flag $1"; exit 1 ;;
  esac
done

color() { printf "\033[1;36m==> %s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33m!! %s\033[0m\n" "$*" >&2; }
die()   { printf "\033[1;31mxx %s\033[0m\n" "$*" >&2; exit 1; }

# -- 1. deps -----------------------------------------------------------------
if [[ ! -d node_modules ]]; then
  color "Installing Node deps"
  npm install
fi
if ! python3 -c "import aioquic" 2>/dev/null; then
  color "Installing aioquic (python)"
  python3 -m pip install --user --break-system-packages aioquic >/dev/null
fi

# -- 2. cert -----------------------------------------------------------------
if [[ ! -f certs/cert.der || ! -f certs/key.pem ]]; then
  color "Generating self-signed cert (ECDSA P-256, 14d)"
  node scripts/gen-cert.js
fi

# -- 3. start children -------------------------------------------------------
pids=()
cleanup() {
  warn "shutting down (PIDs: ${pids[*]:-none})"
  for pid in "${pids[@]:-}"; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM HUP

color "Starting Node HTTP server on :$PORT"
PORT="$PORT" node server/index.js &
pids+=("$!")

color "Starting Python QUIC sidecar on udp/$WT_PORT"
python3 server/webtransport_sidecar.py \
  --cert certs/cert.pem --key certs/key.pem --port "$WT_PORT" &
pids+=("$!")

color "All up.  Open  http://localhost:$PORT"
echo "    (Ctrl+C stops everything)"

# Wait for either child to exit.  As soon as one dies we kill the rest.
wait -n 2>/dev/null
warn "a child process exited — tearing the rest down"
exit 0
