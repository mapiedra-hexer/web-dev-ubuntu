import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { Instance, Settings } from '@shared/types'
import { paths } from './paths'

export const DEFAULT_SETTINGS: Settings = {
  projectsDir: join(homedir(), 'proyectos'),
  githubOrgs: [],
  repoPrefixes: [
    { prefix: 'dob-wordpress-', type: 'wordpress' },
    { prefix: 'dob-prestashop-', type: 'prestashop' }
  ],
  showAllRepos: false,
  domainOverrides: {},
  driveFolderId: '',
  httpPort: 80,
  httpsPort: 443,
  https: true,
  imageRepository: '',
  defaultPhp: '8.2',
  localAdminUser: 'devhub',
  localAdminPassword: 'devhub',
  wpPluginsToDisable: [
    'wordfence',
    'really-simple-ssl',
    'wp-rocket',
    'w3-total-cache',
    'wp-super-cache',
    'litespeed-cache',
    'wp-fastest-cache',
    'sg-cachepress',
    'autoptimize',
    'wp-mail-smtp',
    'post-smtp',
    'better-wp-security',
    'all-in-one-wp-security-and-firewall',
    'wps-hide-login',
    'limit-login-attempts-reloaded',
    'updraftplus'
  ],
  psModulesToDisable: ['pagecache', 'jprestaspeedpack', 'ets_superspeed', 'ps_mbo'],
  githubClientId: '',
  googleClientId: '',
  googleClientSecret: ''
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Escritura atómica: fichero temporal + rename. */
export function writeJson(file: string, data: unknown, mode = 0o600): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode })
  renameSync(tmp, file)
}

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(paths.settings, {}) }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  writeJson(paths.settings, next)
  return next
}

export function listInstances(): Instance[] {
  return readJson<Instance[]>(paths.instances, [])
}

export function getInstance(id: string): Instance {
  const inst = listInstances().find((i) => i.id === id)
  if (!inst) throw new Error(`No existe la instancia ${id}`)
  return inst
}

export function saveInstance(inst: Instance): Instance {
  const all = listInstances().filter((i) => i.id !== inst.id)
  all.push(inst)
  all.sort((a, b) => a.id.localeCompare(b.id))
  writeJson(paths.instances, all)
  return inst
}

export function updateInstance(id: string, patch: Partial<Instance>): Instance {
  return saveInstance({ ...getInstance(id), ...patch })
}

export function deleteInstance(id: string): void {
  writeJson(
    paths.instances,
    listInstances().filter((i) => i.id !== id)
  )
}
