import { shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { createWriteStream, existsSync, renameSync, statSync } from 'fs'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { isDomain, normalizeDomain } from '@shared/domain'
import type { DumpFile, DumpManifest } from '@shared/types'
import { paths } from '../paths'
import { readSecrets, writeSecrets } from '../secrets'
import { getSettings } from '../store'

const SCOPES = 'https://www.googleapis.com/auth/drive.readonly openid email'
const DRIVE = 'https://www.googleapis.com/drive/v3'

function clientCreds(): { id: string; secret: string } {
  const s = getSettings()
  return {
    id: s.googleClientId || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID || '',
    secret: s.googleClientSecret || import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET || ''
  }
}

export function googleConfigured(): boolean {
  return !!clientCreds().id
}

const b64url = (b: Buffer): string => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/**
 * Login OAuth para apps de escritorio: abre el navegador y recibe el código en un
 * servidor loopback efímero (127.0.0.1, puerto aleatorio) que se cierra al terminar. Usa PKCE.
 */
export async function googleLogin(): Promise<string> {
  const { id, secret } = clientCreds()
  if (!id) throw new Error('Falta el client_id de Google (Configuración → Avanzado)')
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (u.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const err = u.searchParams.get('error')
      const c = u.searchParams.get('code')
      const ok = !err && c && u.searchParams.get('state') === state
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<html><body style="font-family:sans-serif;padding:3em"><h2>${ok ? 'DevHub conectado con Google' : 'No se pudo conectar'}</h2><p>Ya puedes cerrar esta pestaña.</p></body></html>`
      )
      clearTimeout(timeout)
      server.close()
      if (ok) resolve({ code: c!, redirectUri })
      else reject(new Error(err ?? 'Respuesta OAuth no válida'))
    })
    const timeout = setTimeout(() => {
      server.close()
      reject(new Error('Tiempo de espera agotado en el login de Google'))
    }, 5 * 60 * 1000)
    let redirectUri = ''
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      auth.search = new URLSearchParams({
        client_id: id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state
      }).toString()
      void shell.openExternal(auth.toString())
    })
  })

  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: id,
    client_secret: secret
  })
  if (!tok.refresh_token) throw new Error('Google no devolvió refresh_token')
  writeSecrets({
    googleRefreshToken: tok.refresh_token,
    googleAccessToken: tok.access_token,
    googleAccessExpires: Date.now() + (tok.expires_in - 60) * 1000
  })
  return googleEmail()
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
  const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; error?: string; error_description?: string }
  if (!res.ok) throw new Error(`Google: ${json.error_description ?? json.error ?? res.status}`)
  return json
}

async function accessToken(): Promise<string> {
  const s = readSecrets()
  if (!s.googleRefreshToken) throw new Error('Google Drive no está conectado (Configuración)')
  if (s.googleAccessToken && s.googleAccessExpires && s.googleAccessExpires > Date.now()) return s.googleAccessToken
  const { id, secret } = clientCreds()
  const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.googleRefreshToken, client_id: id, client_secret: secret })
  writeSecrets({ googleAccessToken: tok.access_token, googleAccessExpires: Date.now() + (tok.expires_in - 60) * 1000 })
  return tok.access_token
}

export function googleConnected(): boolean {
  return !!readSecrets().googleRefreshToken
}

export async function googleEmail(): Promise<string> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${await accessToken()}` } })
  if (!res.ok) throw new Error(`Google ${res.status}`)
  return ((await res.json()) as { email: string }).email
}

export function googleLogout(): void {
  writeSecrets({ googleRefreshToken: undefined, googleAccessToken: undefined, googleAccessExpires: undefined })
}

async function drive<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(DRIVE + path)
  url.search = new URLSearchParams(params).toString()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } })
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

interface DriveFile {
  id: string
  name: string
  size?: string
  modifiedTime?: string
}

const DUMP_RE = /^(.+?)\.(sql\.gz|sql|zip)$/i

/** "zoraida.es.sql.gz" -> "zoraida.es"; null si no es un volcado. */
export function domainFromDumpName(name: string): string | null {
  const m = name.match(DUMP_RE)
  if (!m) return null
  const d = normalizeDomain(m[1])
  return isDomain(d) ? d : null
}

async function listFiles(q: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken = ''
  do {
    const params: Record<string, string> = {
      q,
      fields: 'nextPageToken, files(id,name,size,modifiedTime)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
      orderBy: 'modifiedTime desc'
    }
    if (pageToken) params.pageToken = pageToken
    const r = await drive<{ files: DriveFile[]; nextPageToken?: string }>('/files', params)
    out.push(...r.files)
    pageToken = r.nextPageToken ?? ''
  } while (pageToken)
  return out
}

function toDump(f: DriveFile, domain: string): DumpFile {
  return { id: f.id, name: f.name, domain, size: f.size ? Number(f.size) : undefined, modifiedTime: f.modifiedTime }
}

/** Volcados de la carpeta configurada, uno por dominio (el más reciente) con su manifiesto si existe. */
export async function listDumps(): Promise<DumpFile[]> {
  const folder = getSettings().driveFolderId.trim()
  if (!folder || !googleConnected()) return []
  const files = await listFiles(`'${folder.replace(/'/g, "\\'")}' in parents and trashed=false`)
  const byDomain = new Map<string, DumpFile>()
  const manifests = new Map<string, DriveFile>()
  for (const f of files) {
    if (f.name.toLowerCase().endsWith('.json')) {
      const d = normalizeDomain(f.name.slice(0, -5))
      if (isDomain(d)) manifests.set(d, f)
      continue
    }
    const domain = domainFromDumpName(f.name)
    if (!domain || byDomain.has(domain)) continue
    byDomain.set(domain, toDump(f, domain))
  }
  await Promise.all(
    [...byDomain.values()].map(async (d) => {
      const mf = manifests.get(d.domain)
      if (mf) d.manifest = await fetchManifest(mf.id).catch(() => undefined)
    })
  )
  return [...byDomain.values()]
}

async function fetchManifest(id: string): Promise<DumpManifest> {
  const res = await fetch(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${await accessToken()}` } })
  if (!res.ok) throw new Error(`Drive ${res.status}`)
  return (await res.json()) as DumpManifest
}

/** Buscador manual por nombre, en la carpeta de volcados o en todo lo accesible. */
export async function searchDumps(term: string, everywhere: boolean): Promise<DumpFile[]> {
  const t = term.trim().replace(/'/g, "\\'")
  if (!t) return []
  const folder = getSettings().driveFolderId.trim()
  let q = `name contains '${t}' and trashed=false and mimeType != 'application/vnd.google-apps.folder'`
  if (!everywhere && folder) q += ` and '${folder.replace(/'/g, "\\'")}' in parents`
  const files = await listFiles(q)
  return files
    .filter((f) => DUMP_RE.test(f.name))
    .slice(0, 100)
    .map((f) => toDump(f, domainFromDumpName(f.name) ?? ''))
}

/** Descarga un volcado a la caché local (reutiliza si ya está con la misma fecha). */
export async function downloadDump(file: { id: string; name: string; modifiedTime?: string; size?: number }, onProgress?: (p: number) => void): Promise<string> {
  const stamp = (file.modifiedTime ?? '').replace(/[^0-9]/g, '')
  const dest = join(paths.dumpCache, `${file.id}-${stamp}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`)
  if (existsSync(dest) && (!file.size || statSync(dest).size === file.size)) return dest
  const res = await fetch(`${DRIVE}/files/${file.id}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`, {
    headers: { Authorization: `Bearer ${await accessToken()}` }
  })
  if (!res.ok || !res.body) throw new Error(`Drive ${res.status}: no se pudo descargar ${file.name}`)
  const total = Number(res.headers.get('content-length') ?? file.size ?? 0)
  let got = 0
  const body = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
  body.on('data', (c: Buffer) => {
    got += c.length
    if (total) onProgress?.(got / total)
  })
  const tmp = dest + '.part'
  await pipeline(body, createWriteStream(tmp))
  renameSync(tmp, dest)
  return dest
}
