import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { paths } from './paths'

/**
 * Tokens de GitHub y Google. Se cifran con el llavero del sistema (libsecret / kwallet)
 * a través de safeStorage; si no hay llavero disponible se guardan en claro con permisos 0600.
 */
export interface Secrets {
  githubToken?: string
  googleRefreshToken?: string
  googleAccessToken?: string
  googleAccessExpires?: number
}

const PLAIN_PREFIX = 'plain:'

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

export function readSecrets(): Secrets {
  if (!existsSync(paths.secrets)) return {}
  try {
    const raw = readFileSync(paths.secrets)
    const asText = raw.toString('utf8')
    if (asText.startsWith(PLAIN_PREFIX)) return JSON.parse(asText.slice(PLAIN_PREFIX.length))
    return JSON.parse(safeStorage.decryptString(raw))
  } catch {
    return {}
  }
}

export function writeSecrets(patch: Partial<Secrets>): Secrets {
  const next = { ...readSecrets(), ...patch }
  for (const k of Object.keys(next) as (keyof Secrets)[]) if (next[k] === undefined) delete next[k]
  const json = JSON.stringify(next)
  const data = canEncrypt() ? safeStorage.encryptString(json) : Buffer.from(PLAIN_PREFIX + json, 'utf8')
  writeFileSync(paths.secrets, data, { mode: 0o600 })
  return next
}
