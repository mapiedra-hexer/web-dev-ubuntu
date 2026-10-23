import { describe, expect, it } from 'vitest'
import { mergeCatalog, searchCatalog } from './catalog'
import type { DumpFile, RepoInfo, RepoPrefix } from './types'

const prefixes: RepoPrefix[] = [
  { prefix: 'dob-wordpress-', type: 'wordpress' },
  { prefix: 'dob-prestashop-', type: 'prestashop' }
]

function repo(name: string, homepage = ''): RepoInfo {
  return {
    fullName: `dobuss/${name}`,
    name,
    description: '',
    homepage,
    defaultBranch: 'master',
    pushedAt: '2026-10-01T00:00:00Z',
    cloneUrl: `https://github.com/dobuss/${name}.git`,
    private: true
  }
}

const dump = (domain: string): DumpFile => ({ id: domain, name: `${domain}.sql.gz`, domain })

describe('mergeCatalog', () => {
  const rows = mergeCatalog(
    [
      repo('dob-wordpress-chatarreriascordoba', 'chatarreriascordoba.es'),
      repo('dob-wordpress-zoraida', 'https://www.zoraida.es/'),
      repo('dob-prestashop-sinhomepage'),
      repo('otro-repo', 'otro.es')
    ],
    [dump('chatarreriascordoba.es'), dump('huerfano.com')],
    { prefixes, showAll: false, overrides: {}, mounted: [{ id: 'zoraida-es', domain: 'zoraida.es' }] }
  )
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))

  it('cruza repo y volcado por dominio', () => {
    expect(byKey['chatarreriascordoba.es'].repo?.name).toBe('dob-wordpress-chatarreriascordoba')
    expect(byKey['chatarreriascordoba.es'].dump?.name).toBe('chatarreriascordoba.es.sql.gz')
    expect(byKey['chatarreriascordoba.es'].type).toBe('wordpress')
    expect(byKey['chatarreriascordoba.es'].warnings).toEqual([])
  })
  it('normaliza homepage con www y avisa si falta el volcado', () => {
    expect(byKey['zoraida.es'].warnings).toContain('No hay copia de BD en Drive')
    expect(byKey['zoraida.es'].mountedIds).toEqual(['zoraida-es'])
  })
  it('muestra repos sin dominio y volcados sin repo', () => {
    expect(byKey['repo:dobuss/dob-prestashop-sinhomepage'].type).toBe('prestashop')
    expect(byKey['huerfano.com'].repo).toBeUndefined()
  })
  it('filtra repos sin prefijo salvo showAll', () => {
    expect(byKey['otro.es']).toBeUndefined()
  })
  it('usa el dominio asignado a mano', () => {
    const r = mergeCatalog([repo('dob-prestashop-sinhomepage')], [], {
      prefixes,
      showAll: false,
      overrides: { 'dobuss/dob-prestashop-sinhomepage': 'tienda.es' },
      mounted: []
    })
    expect(r[0].domain).toBe('tienda.es')
  })

  it('busca por dominio, nombre de repo, fragmento o URL', () => {
    expect(searchCatalog(rows, 'zoraida.es').map((r) => r.key)).toEqual(['zoraida.es'])
    expect(searchCatalog(rows, 'dob-wordpress-zoraida').map((r) => r.key)).toEqual(['zoraida.es'])
    expect(searchCatalog(rows, 'zorai').map((r) => r.key)).toEqual(['zoraida.es'])
    expect(searchCatalog(rows, 'https://www.zoraida.es/contacto').map((r) => r.key)).toEqual(['zoraida.es'])
    expect(searchCatalog(rows, '').length).toBe(rows.length)
  })
})
