#!/bin/sh
# Aggiorna wa-categorizer su dkct.
#
#   ssh root@<host> 'sh /data/stacks/wa-categorizer/app/deploy/dkct/update.sh'
#
# Scarica l'immagine già costruita da GitHub Actions e riavvia lo stack.
# Nessun build qui: su dkct non funzionerebbe (l'agent Hawser ha /root in
# sola lettura, buildx non può creare /root/.docker).
#
# Di norma NON serve questo script: il compose ha `pull_policy: always`, quindi
# basta un "recreate" dal pannello di Dockhand per prendere l'ultima immagine.
set -e

DIR=/data/stacks/wa-categorizer
cd "$DIR"

echo "→ allineo il compose dal repo (se presente)"
if [ -f app/deploy/dkct/compose.yaml ]; then
  cp app/deploy/dkct/compose.yaml compose.yaml
else
  echo "  (nessun clone del repo: uso il compose già presente)"
fi

echo "→ scarico l'ultima immagine"
docker compose pull

echo "→ riavvio lo stack"
docker compose up -d

echo "→ stato"
docker compose ps

echo
echo "Fatto. I log:  docker compose logs -f wa-categorizer"
