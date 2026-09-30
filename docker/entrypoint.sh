#!/bin/sh
# Container start: prepare the folders and, if missing, create rules.yaml
# from the example.
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
AUTH_DIR="${AUTH_DIR:-$DATA_DIR/auth}"

mkdir -p "$AUTH_DIR" "$DATA_DIR"
export DATA_DIR AUTH_DIR

# First start without any configuration: begin from the example
if [ ! -f /app/config/rules.yaml ] && [ ! -f /app/config/rules.yml ] && [ ! -f /app/config/rules.json ]; then
  if [ -f /app/config/rules.example.yaml ]; then
    echo "[entrypoint] config/rules.yaml missing: creating it from rules.example.yaml"
    cp /app/config/rules.example.yaml /app/config/rules.yaml
  fi
fi

if [ ! -f "$AUTH_DIR/creds.json" ]; then
  echo "[entrypoint] no WhatsApp session found in $AUTH_DIR"
  echo "[entrypoint] on first start a QR appears in the logs: scan it from WhatsApp > Linked devices"
fi

exec "$@"
