import { isDomain, normalizeDomain } from './domain'
import type { CatalogRow, CmsType, DumpFile, RepoInfo, RepoPrefix } from './types'

export function typeFromRepoName(name: string, prefixes: RepoPrefix[]): CmsType | null {
  const p = prefixes.find((x) => name.toLowerCase().startsWith(x.prefix.toLowerCase()))
  return p ? p.type : null
}

export function repoDomain(repo: RepoInfo, overrides: Record<string, string>): string | null {
  const raw = overrides[repo.fullName] || repo.homepage
  if (!raw) return null
  const d = normalizeDomain(raw)
  return isDomain(d) ? d : null
}

/**
 * Cruza repos y dumps usando el dominio como clave común.
 * Una fila por dominio; los repos sin dominio y los dumps sin repo también aparecen, con aviso.
 */
export function mergeCatalog(
  repos: RepoInfo[],
  dumps: DumpFile[],
  opts: {
    prefixes: RepoPrefix[]
    showAll: boolean
    overrides: Record<string, string>
    mounted: { id: string; domain: string; repoFullName?: string }[]
  }
): CatalogRow[] {
  const rows = new Map<string, CatalogRow>()
  const dumpByDomain = new Map(dumps.map((d) => [d.domain, d]))

  for (const repo of repos) {
    const type = typeFromRepoName(repo.name, opts.prefixes)
    if (!type && !opts.showAll) continue
    const domain = repoDomain(repo, opts.overrides)
    const key = domain ?? `repo:${repo.fullName}`
    const existing = rows.get(key)
    if (existing && existing.repo) {
      existing.warnings.push(`Otro repo (${repo.fullName}) usa el mismo dominio`)
      continue
    }
    const dump = domain ? dumpByDomain.get(domain) : undefined
    const warnings: string[] = []
    if (!domain) warnings.push('El repo no tiene dominio en "About" (homepage)')
    else if (!dump) warnings.push('No hay copia de BD en Drive')
    rows.set(key, {
      key,
      domain,
      type: type ?? (dump?.manifest?.cms as CmsType | undefined) ?? 'unknown',
      repo,
      dump,
      mountedIds: [],
      warnings
    })
  }

  for (const dump of dumps) {
    if (rows.has(dump.domain)) continue
    rows.set(dump.domain, {
      key: dump.domain,
      domain: dump.domain,
      type: (dump.manifest?.cms as CmsType | undefined) ?? 'unknown',
      dump,
      mountedIds: [],
      warnings: ['Hay copia de BD pero ningún repo con este dominio']
    })
  }

  for (const m of opts.mounted) {
    const row =
      rows.get(m.domain) ?? [...rows.values()].find((r) => r.repo && r.repo.fullName === m.repoFullName)
    if (row) row.mountedIds.push(m.id)
  }

  return [...rows.values()].sort((a, b) => (a.domain ?? a.key).localeCompare(b.domain ?? b.key))
}

/** Búsqueda por dominio, nombre de repo o descripción. Acepta URLs completas. */
export function searchCatalog(rows: CatalogRow[], query: string): CatalogRow[] {
  const raw = query.trim().toLowerCase()
  if (!raw) return rows
  const asDomain = normalizeDomain(raw)
  return rows.filter((r) => {
    const hay = [r.domain ?? '', r.repo?.name ?? '', r.repo?.fullName ?? '', r.repo?.description ?? '', r.dump?.name ?? '']
      .join(' ')
      .toLowerCase()
    return hay.includes(raw) || (asDomain !== '' && hay.includes(asDomain))
  })
}
