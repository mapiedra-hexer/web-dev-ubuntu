import type { DeviceCode, RepoInfo } from '@shared/types'
import { readSecrets, writeSecrets } from '../secrets'
import { getSettings } from '../store'

const API = 'https://api.github.com'

export function githubClientId(): string {
  return getSettings().githubClientId || import.meta.env.MAIN_VITE_GITHUB_CLIENT_ID || ''
}

export function githubToken(): string | undefined {
  return readSecrets().githubToken
}

async function gh<T>(path: string, init: RequestInit = {}, token = githubToken()): Promise<{ data: T; next: string | null }> {
  if (!token) throw new Error('GitHub no está conectado (Configuración)')
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devhub',
      ...(init.headers ?? {})
    }
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`)
  }
  const link = res.headers.get('link') ?? ''
  const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null
  return { data: (await res.json()) as T, next }
}

export async function githubUser(token = githubToken()): Promise<string> {
  const { data } = await gh<{ login: string }>('/user', {}, token)
  return data.login
}

interface ApiRepo {
  name: string
  full_name: string
  description: string | null
  homepage: string | null
  default_branch: string
  pushed_at: string
  clone_url: string
  private: boolean
  archived: boolean
}

export async function listRepos(orgs: string[]): Promise<RepoInfo[]> {
  const starts = orgs.length
    ? orgs.map((o) => `/orgs/${encodeURIComponent(o)}/repos?per_page=100&type=all&sort=pushed`)
    : ['/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=pushed']
  const all: RepoInfo[] = []
  for (const start of starts) {
    let url: string | null = start
    while (url) {
      const page: { data: ApiRepo[]; next: string | null } = await gh<ApiRepo[]>(url)
      for (const r of page.data) {
        if (r.archived) continue
        all.push({
          fullName: r.full_name,
          name: r.name,
          description: r.description ?? '',
          homepage: r.homepage ?? '',
          defaultBranch: r.default_branch,
          pushedAt: r.pushed_at,
          cloneUrl: r.clone_url,
          private: r.private
        })
      }
      url = page.next
    }
  }
  return all
}

export async function setHomepage(fullName: string, homepage: string): Promise<void> {
  await gh(`/repos/${fullName}`, { method: 'PATCH', body: JSON.stringify({ homepage }), headers: { 'Content-Type': 'application/json' } })
}

/**
 * Device flow de OAuth: devuelve el código que el usuario introduce en github.com/login/device
 * y en segundo plano espera a que autorice. Solo necesita el client_id (sin secreto).
 */
export async function startDeviceLogin(onDone: (result: { login?: string; error?: string }) => void): Promise<DeviceCode> {
  const clientId = githubClientId()
  if (!clientId) throw new Error('Falta el client_id de la OAuth App de GitHub (Configuración → Avanzado)')
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo read:org' })
  })
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`)
  const dc = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }

  void (async () => {
    let interval = (dc.interval || 5) * 1000
    const deadline = Date.now() + dc.expires_in * 1000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval))
      const t = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          device_code: dc.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      })
        .then((r) => r.json() as Promise<{ access_token?: string; error?: string; interval?: number }>)
        .catch(() => ({ error: 'network' }) as { access_token?: string; error?: string; interval?: number })
      if (t.access_token) {
        writeSecrets({ githubToken: t.access_token })
        onDone({ login: await githubUser(t.access_token).catch(() => undefined) })
        return
      }
      if (t.error === 'slow_down') interval = ((t.interval ?? interval / 1000) + 5) * 1000
      else if (t.error && !['authorization_pending', 'network'].includes(t.error)) {
        onDone({ error: t.error === 'access_denied' ? 'Autorización cancelada' : t.error })
        return
      }
    }
    onDone({ error: 'El código ha caducado' })
  })()

  return { userCode: dc.user_code, verificationUri: dc.verification_uri, expiresIn: dc.expires_in }
}
