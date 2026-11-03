#!/bin/sh
# Runs as root only long enough to make the data folders writable, then drops to the app user.
# Docker creates named-volume mount points owned by root, and a volume created by an older image
# keeps that ownership; without this the live service cannot clone F1DB (git exit code 128).
set -e
for d in /app/data/raw /app/data/live /app/artifacts; do
  mkdir -p "$d"
  chown -R f1qp:f1qp "$d"
done
exec setpriv --reuid=f1qp --regid=f1qp --init-groups "$@"
