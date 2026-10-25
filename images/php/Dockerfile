# Imagen PHP + Apache para proyectos WordPress / PrestaShop de DevHub.
#   docker build --build-arg PHP_VERSION=8.2 -t devhub/php:8.2 images/php
ARG PHP_VERSION=8.2
FROM php:${PHP_VERSION}-apache

COPY --from=mlocati/php-extension-installer:2 /usr/bin/install-php-extensions /usr/local/bin/

# Las bases Debian antiguas (buster: 7.1–7.2; bullseye: 7.3–8.0) ya
# no están en los mirrors normales: a veces falla el update y otras solo las
# descargas. Si la instalación falla por lo que sea, se pasa a archive.debian.org.
RUN set -eux; \
    PKGS="msmtp mariadb-client less unzip git curl ca-certificates"; \
    if ! { apt-get update && apt-get install -y --no-install-recommends $PKGS; }; then \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do \
        [ -f "$f" ] || continue; \
        sed -i -e 's|deb.debian.org|archive.debian.org|g' \
               -e 's|security.debian.org/debian-security|archive.debian.org/debian-security|g' \
               -e 's|security.debian.org|archive.debian.org/debian-security|g' \
               -e '/-updates/d' "$f"; \
      done; \
      echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99devhub-archive; \
      rm -rf /var/lib/apt/lists/*; \
      apt-get update; \
      apt-get install -y --no-install-recommends $PKGS; \
    fi; \
    rm -rf /var/lib/apt/lists/*

RUN install-php-extensions gd mysqli pdo_mysql intl zip soap bcmath opcache exif imagick xdebug @composer

RUN set -eux; \
    curl -fsSL -o /usr/local/bin/wp https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar; \
    chmod +x /usr/local/bin/wp; \
    a2enmod rewrite headers expires remoteip

COPY php.ini /usr/local/etc/php/conf.d/zz-devhub.ini
COPY vhost.conf /etc/apache2/sites-available/000-default.conf
COPY msmtprc /etc/msmtprc
COPY devhub-entrypoint.sh /usr/local/bin/devhub-entrypoint

# Valores por defecto; DevHub los sobrescribe por instancia.
ENV APACHE_DOCUMENT_ROOT=/var/www/html \
    PROD_URL="" \
    HOST_UID=1000 \
    HOST_GID=1000 \
    XDEBUG_MODE=off

RUN chmod +x /usr/local/bin/devhub-entrypoint
ENTRYPOINT ["devhub-entrypoint"]
CMD ["apache2-foreground"]
