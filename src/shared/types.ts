export type CmsType = 'wordpress' | 'prestashop' | 'unknown'

export type PhpVersion = '5.6' | '7.1' | '7.2' | '7.3' | '7.4' | '8.0' | '8.1' | '8.2' | '8.3' | '8.4'

export interface RepoPrefix {
  prefix: string
  type: CmsType
}

export interface Settings {
  projectsDir: string
  githubOrgs: string[]
  repoPrefixes: RepoPrefix[]
  showAllRepos: boolean
  /** Dominio asignado a mano cuando el repo no tiene `homepage`, clave = full_name. */
  domainOverrides: Record<string, string>
  driveFolderId: string
  httpPort: number
  httpsPort: number
  https: boolean
  /** Si se define (p. ej. ghcr.io/dobuss/devhub-php) se hace pull; si no, build local. */
  imageRepository: string
  defaultPhp: PhpVersion
  localAdminUser: string
  localAdminPassword: string
  wpPluginsToDisable: string[]
  psModulesToDisable: string[]
  /** Sobrescriben los client_id incrustados en el build. */
  githubClientId: string
  googleClientId: string
  googleClientSecret: string
}

export type DbStatus = 'ready' | 'pending' | 'importing' | 'error'

export interface DbSourceAuto {
  kind: 'drive'
  fileId: string
  name: string
  modifiedTime?: string
  size?: number
}
export interface DbSourceLocal {
  kind: 'local'
  path: string
}
export interface DbSourceNone {
  kind: 'none'
}
export type DbSource = DbSourceAuto | DbSourceLocal | DbSourceNone

export interface Instance {
  id: string
  /** Dominio de producción, p. ej. zoraida.es */
  domain: string
  /** Dominio local, p. ej. zoraida.es.localhost o php83.zoraida.es.localhost */
  localDomain: string
  /** Etiqueta de duplicado (php83, feature-x); vacío en la instancia principal. */
  label: string
  parentId?: string
  repoFullName?: string
  cloneUrl?: string
  type: CmsType
  cmsVersion?: string
  php: PhpVersion
  branch: string
  codePath: string
  /** Ruta relativa dentro del repo que hace de DocumentRoot ('' = raíz). */
  docroot: string
  dbName: string
  dbPrefix: string
  dbStatus: DbStatus
  dbSource?: DbSource
  dbImportedAt?: string
  xdebug: boolean
  ownsCode: boolean
  createdAt: string
  /** Credenciales del admin local creadas tras importar. */
  adminLogin?: { user: string; password: string; url: string }
}

export type ContainerState = 'running' | 'exited' | 'created' | 'restarting' | 'paused' | 'missing'

export interface InstanceView extends Instance {
  state: ContainerState
  url: string
}

export interface RepoInfo {
  fullName: string
  name: string
  description: string
  homepage: string
  defaultBranch: string
  pushedAt: string
  cloneUrl: string
  private: boolean
}

export interface DumpFile {
  id: string
  name: string
  domain: string
  size?: number
  modifiedTime?: string
  manifest?: DumpManifest
}

export interface DumpManifest {
  domain?: string
  php_version?: string
  cms?: string
  cms_version?: string
  db_prefix?: string
  server?: string
  dumped_at?: string
}

export interface CatalogRow {
  key: string
  domain: string | null
  type: CmsType
  repo?: RepoInfo
  dump?: DumpFile
  mountedIds: string[]
  warnings: string[]
}

export type CheckStatus = 'ok' | 'warn' | 'error' | 'pending'

export interface SetupCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  action?: { id: string; label: string }
}

export type JobStatus = 'running' | 'done' | 'error'

export interface Job {
  id: string
  title: string
  instanceId?: string
  status: JobStatus
  step: string
  progress: number | null
  log: string[]
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface MountRequest {
  repoFullName?: string
  cloneUrl?: string
  domain: string
  type?: CmsType
  php: PhpVersion | 'auto'
  branch?: string
  dbSource: DbSource | { kind: 'auto' }
}

export interface DuplicateRequest {
  sourceId: string
  label: string
  php: PhpVersion
  /** 'shared': misma carpeta de código (solo WordPress). 'worktree': git worktree. */
  codeMode: 'shared' | 'worktree'
  baseBranch?: string
  newBranch?: string
  copyIgnored: boolean
}

export interface IntegrationStatus {
  github: { connected: boolean; login?: string; error?: string; clientIdConfigured: boolean }
  google: { connected: boolean; email?: string; error?: string; clientIdConfigured: boolean }
}

export interface DeviceCode {
  userCode: string
  verificationUri: string
  expiresIn: number
}

export interface Snapshot {
  name: string
  createdAt: string
  size: number
}

export interface PluginUpdate {
  name: string
  version: string
  updateVersion: string
}

export interface CoreStatus {
  running: boolean
  services: { name: string; state: string }[]
  links: { label: string; url: string }[]
}
