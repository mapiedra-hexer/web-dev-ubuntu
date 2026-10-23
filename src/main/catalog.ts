import { mergeCatalog } from '@shared/catalog'
import type { CatalogRow, DumpFile, RepoInfo } from '@shared/types'
import { paths } from './paths'
import { getSettings, listInstances, readJson, writeJson } from './store'
import { githubToken, listRepos } from './integrations/github'
import { googleConnected, listDumps } from './integrations/drive'

interface CatalogCache {
  fetchedAt: string
  repos: RepoInfo[]
  dumps: DumpFile[]
  errors: string[]
}

let cache: CatalogCache | null = null

async function refresh(): Promise<CatalogCache> {
  const s = getSettings()
  const errors: string[] = []
  const [repos, dumps] = await Promise.all([
    githubToken()
      ? listRepos(s.githubOrgs).catch((e: Error) => {
          errors.push(e.message)
          return cache?.repos ?? []
        })
      : Promise.resolve([] as RepoInfo[]),
    googleConnected()
      ? listDumps().catch((e: Error) => {
          errors.push(e.message)
          return cache?.dumps ?? []
        })
      : Promise.resolve([] as DumpFile[])
  ])
  cache = { fetchedAt: new Date().toISOString(), repos, dumps, errors }
  writeJson(paths.catalogCache, cache)
  return cache
}

/**
 * Índice de repos + volcados cacheado en disco: la primera carga es instantánea y
 * la ventana pide un refresco en segundo plano.
 */
export async function catalog(forceRefresh: boolean): Promise<CatalogRow[]> {
  if (!cache) cache = readJson<CatalogCache | null>(paths.catalogCache, null)
  const data = forceRefresh || !cache ? await refresh() : cache
  const s = getSettings()
  const rows = mergeCatalog(data.repos, data.dumps, {
    prefixes: s.repoPrefixes,
    showAll: s.showAllRepos,
    overrides: s.domainOverrides,
    mounted: listInstances().map((i) => ({ id: i.id, domain: i.domain, repoFullName: i.repoFullName }))
  })
  if (data.errors.length) {
    rows.unshift({ key: '__errors', domain: null, type: 'unknown', mountedIds: [], warnings: data.errors })
  }
  return rows
}

export function invalidateCatalog(): void {
  cache = null
}
