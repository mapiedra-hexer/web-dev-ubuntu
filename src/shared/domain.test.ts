import { describe, expect, it } from 'vitest'
import { dbNameFor, instanceIdFor, isDomain, localDomainFor, localUrl, normalizeDomain, toLabel } from './domain'

describe('normalizeDomain', () => {
  it.each([
    ['zoraida.es', 'zoraida.es'],
    ['  Zoraida.ES ', 'zoraida.es'],
    ['https://www.zoraida.es/tienda?x=1#y', 'zoraida.es'],
    ['http://zoraida.es:8080', 'zoraida.es'],
    ['www.chatarreriascordoba.es', 'chatarreriascordoba.es'],
    ['zoraida.es.', 'zoraida.es'],
    ['zoraida.es.localhost', 'zoraida.es'],
    ['', '']
  ])('%s -> %s', (input, out) => expect(normalizeDomain(input)).toBe(out))
})

describe('isDomain', () => {
  it('acepta dominios y rechaza fragmentos', () => {
    expect(isDomain('zoraida.es')).toBe(true)
    expect(isDomain('mi-tienda.co.uk')).toBe(true)
    expect(isDomain('zoraida')).toBe(false)
    expect(isDomain('-mal.es')).toBe(false)
  })
})

describe('identificadores', () => {
  it('genera id, dominio local y nombre de BD', () => {
    expect(instanceIdFor('zoraida.es')).toBe('zoraida-es')
    expect(instanceIdFor('zoraida.es', 'php83')).toBe('zoraida-es--php83')
    expect(localDomainFor('zoraida.es')).toBe('zoraida.es.localhost')
    expect(localDomainFor('zoraida.es', 'php83')).toBe('php83.zoraida.es.localhost')
    expect(dbNameFor('zoraida-es--php83')).toBe('dh_zoraida_es__php83')
  })
  it('limpia etiquetas', () => {
    expect(toLabel('PHP 8.3')).toBe('php-8-3')
    expect(toLabel('Actualización WP')).toBe('actualizacion-wp')
  })
  it('incluye el puerto solo si no es el estándar', () => {
    expect(localUrl('a.es.localhost', { https: true, httpPort: 80, httpsPort: 443 })).toBe('https://a.es.localhost')
    expect(localUrl('a.es.localhost', { https: true, httpPort: 8080, httpsPort: 8443 })).toBe('https://a.es.localhost:8443')
    expect(localUrl('a.es.localhost', { https: false, httpPort: 8080, httpsPort: 8443 })).toBe('http://a.es.localhost:8080')
  })
})
