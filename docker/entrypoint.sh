#!/bin/sh
# Avvio del container: sistema le cartelle e, se manca, crea rules.yaml dall'esempio.
set -e

DATA_DIR="${DATA_DIR:-/app/data}"
AUTH_DIR="${AUTH_DIR:-$DATA_DIR/auth}"

mkdir -p "$AUTH_DIR" "$DATA_DIR"
export DATA_DIR AUTH_DIR

# Primo avvio senza configurazione: parti dall'esempio (nessuna regola attiva di default)
if [ ! -f /app/config/rules.yaml ] && [ ! -f /app/config/rules.yml ] && [ ! -f /app/config/rules.json ]; then
  if [ -f /app/config/rules.example.yaml ]; then
    echo "[entrypoint] config/rules.yaml assente: lo creo da rules.example.yaml"
    cp /app/config/rules.example.yaml /app/config/rules.yaml
  fi
fi

if [ ! -f "$AUTH_DIR/creds.json" ]; then
  echo "[entrypoint] sessione WhatsApp non trovata in $AUTH_DIR"
  echo "[entrypoint] al primo avvio compare un QR nei log: inquadralo da WhatsApp > Dispositivi collegati"
fi

exec "$@"
