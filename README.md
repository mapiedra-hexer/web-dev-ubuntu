# DevHub

Aplicación de escritorio para Ubuntu que monta en local, a golpe de clic, los proyectos WordPress y PrestaShop del equipo:

- **Catálogo**: repos de GitHub cruzados por dominio con las copias de BD de Google Drive. Se busca por dominio o por nombre del repo.
- **Montar**: clona el repo, detecta el CMS y la versión de PHP, genera la configuración local, importa la BD y lo sirve en `https://<dominio>.localhost`.
- **Mis proyectos**: arrancar, parar, eliminar, duplicar en otra versión de PHP o en otra rama, reimportar la BD, puntos de restauración, actualizaciones con wp-cli, logs, terminal, Xdebug.
- **Puesta en marcha**: comprueba Docker, puertos, certificados… y lo arregla con un clic.

## Instalación

```bash
sudo apt install ./devhub_X.Y.Z_amd64.deb
```

El paquete instala Docker, Compose, git y mkcert como dependencias y añade al usuario al grupo `docker`. **Cierra sesión y vuelve a entrar** después de la primera instalación. Al abrir DevHub, la pantalla *Puesta en marcha* indica lo que falte (por ejemplo, parar LAMPP si ocupa el puerto 80).

Las actualizaciones llegan solas desde GitHub Releases.

## Cómo funciona

```
DevHub (Electron)  ── docker compose / git / mkcert ──►  Docker
                                                         ├─ devhub-core: Traefik (80/443), MariaDB 10.11, phpMyAdmin, Mailpit
                                                         └─ devhub-<proyecto>: devhub/php:<versión> con el código montado
~/proyectos/<repo>            código (lo editas con tu IDE)
~/proyectos/<repo>@<etiqueta> worktrees de los duplicados
~/.local/share/devhub/        estado, compose de cada proyecto, certificados, caché de volcados
```

- `wp-config.php`, `app/config/parameters.php` y `config/settings.inc.php` se generan leyendo variables de entorno del contenedor, se añaden a `.git/info/exclude` y nunca se suben al repo.
- Las imágenes subidas que no están en git se piden a producción (redirección 302).
- Todo el correo saliente va a Mailpit: `http://mail.localhost`.
- BD: `http://pma.localhost`.
- Al importar se cambian las URLs (wp-cli `search-replace` o SQL en PrestaShop), se desactivan plugins/módulos de caché, seguridad y SMTP (lista configurable) y se crea un **admin local** (`devhub` / `devhub` por defecto).

## Contrato con las copias de BD

DevHub solo lee de Drive. El proceso que genera las copias en los Plesk es un proyecto aparte y debe dejar en la carpeta configurada:

| Fichero | Contenido |
|---|---|
| `<dominio>.sql.gz` (o `.sql`, `.zip`) | Último volcado. Las versiones anteriores pueden ir a una subcarpeta `historico/`. |
| `<dominio>.json` (opcional) | `{ "domain", "php_version", "cms", "cms_version", "db_prefix", "server", "dumped_at" }` |

Si no hay copia, se puede buscar otra en Drive, elegir un archivo local o montar sin BD (estado *Pendiente de BD*).

## Configuración de la organización (una vez)

### GitHub OAuth App
1. GitHub → Organización → Settings → Developer settings → OAuth Apps → *New OAuth App*.
2. Homepage y callback: `http://127.0.0.1` (no se usan con *device flow*).
3. Marca **Enable Device Flow**.
4. El *Client ID* va en la variable de repo `DEVHUB_GITHUB_CLIENT_ID` (se incrusta en el build) o en *Configuración → Avanzado*.

Mientras tanto, cada persona puede usar un token personal con permiso `repo`.

### Google Drive
1. Google Cloud Console → proyecto de la Workspace → habilita **Google Drive API**.
2. Pantalla de consentimiento: tipo **Interno** (sin verificación de Google).
3. Credenciales → *ID de cliente de OAuth* → **Aplicación de escritorio**.
4. `DEVHUB_GOOGLE_CLIENT_ID` (variable) y `DEVHUB_GOOGLE_CLIENT_SECRET` (secreto) en el repo, o en *Configuración → Avanzado*. En las apps de escritorio Google no considera confidencial este secreto.

### Imágenes PHP
El workflow `release.yml` publica `ghcr.io/<org>/devhub-php:<versión>` (7.1 a 8.4). Pon ese repositorio en *Configuración → Avanzado* para descargarlas en vez de construirlas en cada equipo.

## Desarrollo

```bash
npm install
npm run dev          # app con recarga en caliente
npm test             # tests unitarios
npm run test:e2e     # monta un WordPress real con Docker (puertos 8880/8443)
npm run dist:deb     # genera dist/devhub_X.Y.Z_amd64.deb
```

Publicar una versión: sube la versión en `package.json`, crea el tag `vX.Y.Z` y haz push. CI genera el `.deb` y las imágenes.

## Limitaciones conocidas

- PHP 5.6 no está disponible: su base (Debian stretch) tiene caducadas las claves de firma del archivo de Debian y no se puede instalar software verificado. Las versiones soportadas son 7.1 a 8.4.
- WordPress multisite: se monta, pero el dominio de `wp_blogs`/`wp_site` y las constantes `MULTISITE` hay que ajustarlos a mano.
- En PrestaShop los duplicados siempre usan su propia carpeta (worktree): la caché de Symfony no se puede compartir entre instancias.
- Las imágenes de producto de PrestaShop servidas con URL amigable (`/123-home_default/x.jpg`) no pasan por el proxy de media; las rutas `/img/...` sí.
- Al montar se usa el código de la rama elegida; los ficheros no versionados (p. ej. `vendor/` ignorado) hay que generarlos (`composer install` desde la terminal del contenedor).
