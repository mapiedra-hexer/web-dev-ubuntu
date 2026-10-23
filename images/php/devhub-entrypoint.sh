#!/bin/sh
set -e

# Apache (www-data) corre con el UID/GID del usuario del host para que los
# ficheros del bind mount sean editables desde ambos lados.
if [ "$(id -u www-data)" != "$HOST_UID" ]; then
  usermod -o -u "$HOST_UID" www-data >/dev/null 2>&1 || true
fi
if [ "$(id -g www-data)" != "$HOST_GID" ]; then
  groupmod -o -g "$HOST_GID" www-data >/dev/null 2>&1 || true
fi

# Xdebug 3 lee XDEBUG_MODE del entorno; Xdebug 2 (PHP 5.6/7.1) necesita el ini.
XDEBUG_INI=/usr/local/etc/php/conf.d/zz-devhub-xdebug.ini
if [ "$XDEBUG_MODE" = "off" ]; then
  rm -f "$XDEBUG_INI"
  rm -f /usr/local/etc/php/conf.d/docker-php-ext-xdebug.ini
else
  docker-php-ext-enable xdebug >/dev/null 2>&1 || true
  cat > "$XDEBUG_INI" <<EOF
xdebug.mode=${XDEBUG_MODE}
xdebug.start_with_request=yes
xdebug.client_host=host.docker.internal
xdebug.client_port=9003
xdebug.remote_enable=1
xdebug.remote_autostart=1
xdebug.remote_host=host.docker.internal
xdebug.remote_port=9003
EOF
fi

# Las variables DEVHUB_* llegan a PHP vía getenv(); Apache limpia el entorno de
# los hijos en algunas versiones, así que las pasamos explícitamente.
ENV_CONF=/etc/apache2/conf-enabled/zz-devhub-env.conf
: > "$ENV_CONF"
for var in $(env | grep -o '^DEVHUB_[A-Z0-9_]*'); do
  echo "PassEnv $var" >> "$ENV_CONF"
done

mkdir -p /tmp/wp-cli && chown www-data:www-data /tmp/wp-cli

exec docker-php-entrypoint "$@"
