#!/bin/sh
# Acciones de DevHub que necesitan root. Se invoca con pkexec y solo acepta
# las acciones de esta lista; nunca ejecuta comandos arbitrarios.
set -eu

action="${1:-}"
shift || true

valid_user() {
  case "$1" in
    ''|*[!a-z0-9_.-]*) echo "Usuario no válido" >&2; exit 2 ;;
  esac
  id "$1" >/dev/null 2>&1 || { echo "No existe el usuario $1" >&2; exit 2; }
}

case "$action" in
  install-docker)
    valid_user "$1"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y docker.io docker-compose-v2 || apt-get install -y docker.io docker-compose-plugin
    systemctl enable --now docker
    usermod -aG docker "$1"
    echo "Docker instalado. Cierra sesión y vuelve a entrar para usarlo sin sudo."
    ;;
  docker-group)
    valid_user "$1"
    getent group docker >/dev/null || groupadd docker
    usermod -aG docker "$1"
    echo "Usuario $1 añadido al grupo docker"
    ;;
  start-docker)
    systemctl enable --now docker
    echo "Docker arrancado"
    ;;
  install-mkcert)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y mkcert libnss3-tools
    echo "mkcert instalado"
    ;;
  install-ca)
    src="${1:-}"
    case "$src" in
      */rootCA.pem) ;;
      *) echo "Ruta de CA no válida" >&2; exit 2 ;;
    esac
    [ -f "$src" ] || { echo "No existe $src" >&2; exit 2; }
    install -m 0644 "$src" /usr/local/share/ca-certificates/devhub-mkcert-rootCA.crt
    update-ca-certificates >/dev/null
    echo "CA instalada en el sistema"
    ;;
  stop-lampp)
    if [ -x /opt/lampp/lampp ]; then /opt/lampp/lampp stop || true; fi
    echo "LAMPP parado. Puedes volver a arrancarlo con: sudo /opt/lampp/lampp start"
    ;;
  stop-apache)
    for svc in apache2 nginx; do
      if systemctl is-active --quiet "$svc"; then
        systemctl stop "$svc"
        systemctl disable "$svc" >/dev/null 2>&1 || true
        echo "$svc parado y deshabilitado"
      fi
    done
    ;;
  *)
    echo "Acción no permitida: $action" >&2
    exit 2
    ;;
esac
