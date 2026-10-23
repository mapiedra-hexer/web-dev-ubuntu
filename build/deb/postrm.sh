#!/bin/sh
# Al desinstalar no se tocan los proyectos, las bases de datos ni ~/.local/share/devhub:
# se eliminan con "docker compose down" desde la app o a mano.
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  rm -f /usr/bin/devhub
  rm -rf /usr/lib/devhub
fi
exit 0
