import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { CoreStatus } from '@shared/types'
import { compose, coreServices, dockerExec, MARIADB_CONTAINER } from '../docker'
import { ensureDirs, paths, resource, DATA_DIR } from '../paths'
import { getSettings } from '../store'

const PROJECT = 'devhub-core'

/** Lee/crea core.env con los puertos y la contraseña root de MariaDB. */
export function coreEnv(): Record<string, string> {
  ensureDirs()
  const current: Record<string, string> = {}
  if (existsSync(paths.coreEnv)) {
    for (const line of readFileSync(paths.coreEnv, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) current[m[1]] = m[2]
    }
  }
  const s = getSettings()
  const next: Record<string, string> = {
    DEVHUB_HTTP_PORT: String(s.httpPort),
    DEVHUB_HTTPS_PORT: String(s.httpsPort),
    DEVHUB_DATA: DATA_DIR,
    MARIADB_ROOT_PASSWORD: current.MARIADB_ROOT_PASSWORD || randomBytes(12).toString('hex'),
    DEVHUB_DB_PASSWORD: current.DEVHUB_DB_PASSWORD || randomBytes(12).toString('hex')
  }
  const text = Object.entries(next)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  if (!existsSync(paths.coreEnv) || readFileSync(paths.coreEnv, 'utf8').trim() !== text) {
    writeFileSync(paths.coreEnv, text + '\n', { mode: 0o600 })
  }
  return next
}

export function rootPassword(): string {
  return coreEnv().MARIADB_ROOT_PASSWORD
}

/** Usuario de BD que usan los proyectos (todos los privilegios, solo local). */
export function dbUser(): { user: string; password: string } {
  return { user: 'devhub', password: coreEnv().DEVHUB_DB_PASSWORD }
}

function coreFile(): string {
  return resource('core', 'compose.yml')
}

export async function coreUp(onLine?: (l: string) => void): Promise<void> {
  coreEnv()
  await compose(PROJECT, coreFile(), ['up', '-d', '--wait'], { envFile: paths.coreEnv, onLine })
  await ensureDbUser()
}

export async function coreDown(onLine?: (l: string) => void): Promise<void> {
  await compose(PROJECT, coreFile(), ['down'], { envFile: paths.coreEnv, onLine })
}

export async function ensureDbUser(): Promise<void> {
  const { user, password } = dbUser()
  const sql = [
    `CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${password}';`,
    `ALTER USER '${user}'@'%' IDENTIFIED BY '${password}';`,
    `GRANT ALL PRIVILEGES ON *.* TO '${user}'@'%';`,
    'FLUSH PRIVILEGES;'
  ].join('\n')
  await dockerExec(MARIADB_CONTAINER, ['mariadb', '-uroot'], { input: sql, env: { MYSQL_PWD: rootPassword() } })
}

export async function isCoreRunning(): Promise<boolean> {
  const services = await coreServices()
  return services.length >= 4 && services.every((s) => s.state === 'running')
}

export async function coreStatus(): Promise<CoreStatus> {
  const services = await coreServices()
  const s = getSettings()
  const port = s.httpPort === 80 ? '' : `:${s.httpPort}`
  return {
    running: services.length >= 4 && services.every((x) => x.state === 'running'),
    services,
    links: [
      { label: 'phpMyAdmin', url: `http://pma.localhost${port}` },
      { label: 'Mailpit (correo)', url: `http://mail.localhost${port}` },
      { label: 'Traefik', url: `http://traefik.localhost${port}` }
    ]
  }
}
