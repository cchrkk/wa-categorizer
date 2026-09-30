#!/bin/sh
# Aggiorna wa-categorizer su dkct: codice, immagine, riavvio.
#
#   ssh root@192.168.1.100 'sh /data/stacks/wa-categorizer/app/deploy/dkct/update.sh'
#
# Il build lo fa qui e non Dockhand di proposito: l'agent Hawser gira con
# ProtectHome=true e /root read-only, quindi buildx non riesce a scrivere
# /root/.docker. Via SSH non c'è quel vincolo.
set -e

DIR=/data/stacks/wa-categorizer
cd "$DIR"

echo "→ aggiorno il codice"
git -C app pull --ff-only

echo "→ allineo il compose da deploy/dkct/compose.yaml (fonte unica: il repo)"
cp app/deploy/dkct/compose.yaml compose.yaml

echo "→ ricostruisco l'immagine"
docker build -t wa-categorizer:latest app

echo "→ riavvio lo stack"
docker compose up -d

echo "→ stato"
docker compose ps

echo
echo "Fatto. I log:  docker compose logs -f wa-categorizer"
