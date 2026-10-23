#!/bin/sh
# Post-instalación del .deb de DevHub (se ejecuta como root).
set -e

# Script de acciones privilegiadas en una ruta fija y no modificable por el usuario.
install -d -m 0755 /usr/lib/devhub
install -m 0755 /opt/DevHub/resources/build/privileged.sh /usr/lib/devhub/privileged.sh

# Enlace en el PATH y permisos del sandbox de Chromium.
ln -sf /opt/DevHub/devhub /usr/bin/devhub
if [ -f /opt/DevHub/chrome-sandbox ]; then
  chown root:root /opt/DevHub/chrome-sandbox
  chmod 4755 /opt/DevHub/chrome-sandbox
fi

# Docker arrancado y el usuario que instala dentro del grupo docker.
if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
getent group docker >/dev/null || groupadd docker
TARGET_USER="${SUDO_USER:-${PKEXEC_UID:+$(id -nu "$PKEXEC_UID")}}"
if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ]; then
  usermod -aG docker "$TARGET_USER" || true
fi

exit 0
