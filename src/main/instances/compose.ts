import type { Instance } from '@shared/types'

export interface ComposeContext {
  image: string
  url: string
  https: boolean
  hostUid: number
  hostGid: number
  db: { host: string; user: string; password: string }
}

/** Variables de entorno que leen wp-config.php / parameters.php generados por DevHub. */
export function instanceEnv(inst: Instance, ctx: ComposeContext): Record<string, string> {
  return {
    DEVHUB_INSTANCE: inst.id,
    DEVHUB_URL: ctx.url,
    DEVHUB_DOMAIN: inst.localDomain,
    DEVHUB_HTTPS: ctx.https ? '1' : '0',
    DEVHUB_DB_HOST: ctx.db.host,
    DEVHUB_DB_NAME: inst.dbName,
    DEVHUB_DB_USER: ctx.db.user,
    DEVHUB_DB_PASSWORD: ctx.db.password,
    DEVHUB_DB_PREFIX: inst.dbPrefix,
    DEVHUB_MAIL_HOST: 'devhub-mailpit',
    PROD_URL: inst.domain ? `https://${inst.domain}` : '',
    APACHE_DOCUMENT_ROOT: inst.docroot ? `/var/www/html/${inst.docroot}` : '/var/www/html',
    HOST_UID: String(ctx.hostUid),
    HOST_GID: String(ctx.hostGid),
    XDEBUG_MODE: inst.xdebug ? 'debug' : 'off'
  }
}

/**
 * docker-compose de una instancia. Se genera como JSON (YAML válido), así no hace
 * falta dependencia de YAML y sigue siendo legible para depurar a mano.
 */
export function composeFor(inst: Instance, ctx: ComposeContext): object {
  const r = `devhub-${inst.id}`
  const host = `Host(\`${inst.localDomain}\`)`
  const labels: Record<string, string> = {
    'devhub.managed': 'true',
    'devhub.instance': inst.id,
    'traefik.enable': 'true',
    'traefik.docker.network': 'devhub',
    [`traefik.http.services.${r}.loadbalancer.server.port`]: '80',
    [`traefik.http.routers.${r}-http.rule`]: host,
    [`traefik.http.routers.${r}-http.entrypoints`]: 'web',
    [`traefik.http.routers.${r}-http.service`]: r
  }
  if (ctx.https) {
    Object.assign(labels, {
      [`traefik.http.routers.${r}.rule`]: host,
      [`traefik.http.routers.${r}.entrypoints`]: 'websecure',
      [`traefik.http.routers.${r}.tls`]: 'true',
      [`traefik.http.routers.${r}.service`]: r,
      [`traefik.http.middlewares.${r}-https.redirectscheme.scheme`]: 'https',
      [`traefik.http.routers.${r}-http.middlewares`]: `${r}-https`
    })
  }
  return {
    name: r,
    services: {
      php: {
        image: ctx.image,
        container_name: r,
        restart: 'no',
        volumes: [`${inst.codePath}:/var/www/html`],
        environment: instanceEnv(inst, ctx),
        // El propio sitio (wp-cron, loopback de WP, módulos PS) resuelve su dominio local hacia Traefik.
        extra_hosts: [`${inst.localDomain}:host-gateway`, 'host.docker.internal:host-gateway'],
        labels,
        networks: ['devhub']
      }
    },
    networks: { devhub: { external: true, name: 'devhub' } }
  }
}
