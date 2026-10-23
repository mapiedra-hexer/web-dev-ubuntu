import { describe, expect, it } from 'vitest'
import type { Instance } from '@shared/types'
import { composeFor } from './compose'

const inst: Instance = {
  id: 'zoraida-es--php83',
  domain: 'zoraida.es',
  localDomain: 'php83.zoraida.es.localhost',
  label: 'php83',
  type: 'wordpress',
  php: '8.3',
  branch: 'master',
  codePath: '/home/dev/proyectos/dob-wordpress-zoraida',
  docroot: 'httpdocs',
  dbName: 'dh_zoraida_es__php83',
  dbPrefix: 'wpx_',
  dbStatus: 'ready',
  xdebug: true,
  ownsCode: false,
  createdAt: ''
}

const ctx = {
  image: 'devhub/php:8.3',
  url: 'https://php83.zoraida.es.localhost',
  https: true,
  hostUid: 1000,
  hostGid: 1000,
  db: { host: 'devhub-mariadb', user: 'devhub', password: 'pw' }
}

describe('composeFor', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = composeFor(inst, ctx) as any
  const php = c.services.php

  it('monta el código y pasa la configuración por entorno', () => {
    expect(php.image).toBe('devhub/php:8.3')
    expect(php.volumes).toEqual(['/home/dev/proyectos/dob-wordpress-zoraida:/var/www/html'])
    expect(php.environment).toMatchObject({
      DEVHUB_DB_NAME: 'dh_zoraida_es__php83',
      DEVHUB_DB_PREFIX: 'wpx_',
      DEVHUB_URL: 'https://php83.zoraida.es.localhost',
      PROD_URL: 'https://zoraida.es',
      APACHE_DOCUMENT_ROOT: '/var/www/html/httpdocs',
      XDEBUG_MODE: 'debug'
    })
  })

  it('enruta el subdominio en Traefik con HTTPS y redirección', () => {
    const r = 'devhub-zoraida-es--php83'
    expect(php.labels[`traefik.http.routers.${r}.rule`]).toBe('Host(`php83.zoraida.es.localhost`)')
    expect(php.labels[`traefik.http.routers.${r}.tls`]).toBe('true')
    expect(php.labels[`traefik.http.routers.${r}-http.middlewares`]).toBe(`${r}-https`)
    expect(php.labels['devhub.instance']).toBe('zoraida-es--php83')
  })

  it('resuelve el dominio local hacia el host', () => {
    expect(php.extra_hosts).toContain('php83.zoraida.es.localhost:host-gateway')
    expect(c.networks.devhub.external).toBe(true)
  })
})
