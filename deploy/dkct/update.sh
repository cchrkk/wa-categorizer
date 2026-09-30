#!/bin/sh
# Updates wa-categorizer on a server.
#
#   ssh root@<host> 'sh /data/stacks/wa-categorizer/app/deploy/dkct/update.sh'
#
# Downloads the image already built by GitHub Actions and restarts the stack.
# No build here: on hosts where the Docker agent has /root read-only, buildx
# cannot create /root/.docker and the build fails.
#
# Normally you do not need this script: the compose has `pull_policy: always`,
# so a "recreate" from the management panel is enough to pick up the latest
# image.
set -e

DIR=/data/stacks/wa-categorizer
cd "$DIR"

echo "-> syncing the compose from the repo (if present)"
if [ -f app/deploy/dkct/compose.yaml ]; then
  cp app/deploy/dkct/compose.yaml compose.yaml
else
  echo "   (no repo clone: using the compose already here)"
fi

echo "-> pulling the latest image"
docker compose pull

echo "-> restarting the stack"
docker compose up -d

echo "-> status"
docker compose ps

echo
echo "Done. Logs:  docker compose logs -f wa-categorizer"
