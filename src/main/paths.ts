import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'

const xdgData = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')

export const DATA_DIR = process.env.DEVHUB_DATA_DIR || join(xdgData, 'devhub')

export const paths = {
  data: DATA_DIR,
  settings: join(DATA_DIR, 'settings.json'),
  instances: join(DATA_DIR, 'instances.json'),
  secrets: join(DATA_DIR, 'secrets.bin'),
  catalogCache: join(DATA_DIR, 'catalog-cache.json'),
  coreEnv: join(DATA_DIR, 'core.env'),
  certs: join(DATA_DIR, 'certs'),
  traefikDynamic: join(DATA_DIR, 'traefik', 'dynamic'),
  instanceDir: (id: string) => join(DATA_DIR, 'instances', id),
  snapshots: (id: string) => join(DATA_DIR, 'snapshots', id),
  dumpCache: join(DATA_DIR, 'cache', 'dumps')
}

export function ensureDirs(): void {
  for (const d of [paths.data, paths.certs, paths.traefikDynamic, paths.dumpCache, join(DATA_DIR, 'instances')]) {
    mkdirSync(d, { recursive: true })
  }
}

let resourcesRoot = process.cwd()

/** Carpeta con core/, images/ y build/privileged.sh (resources/ en el .deb, raíz del repo en desarrollo). */
export function setResourcesRoot(dir: string): void {
  resourcesRoot = dir
}

export function resource(...parts: string[]): string {
  return join(resourcesRoot, ...parts)
}
