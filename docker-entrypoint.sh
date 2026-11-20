#!/bin/sh
# Arranca como root solo para preparar las carpetas de datos (sean volúmenes o carpetas
# del servidor) y luego cede el proceso al usuario sin privilegios "node".
set -e
DATA_DIR="${DATA_DIR:-/app/data}"
UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"
BACKUP_DIR="${BACKUP_DIR:-$DATA_DIR/backups}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$UPLOAD_DIR" "$BACKUP_DIR"
  chown -R node:node "$DATA_DIR" "$UPLOAD_DIR" "$BACKUP_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
