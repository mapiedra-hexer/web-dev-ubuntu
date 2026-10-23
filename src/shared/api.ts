import type {
  CatalogRow,
  CoreStatus,
  DeviceCode,
  DumpFile,
  DuplicateRequest,
  InstanceView,
  IntegrationStatus,
  Job,
  MountRequest,
  PhpVersion,
  PluginUpdate,
  SetupCheck,
  Settings,
  Snapshot
} from './types'

/**
 * API que el proceso principal expone a la ventana por IPC.
 * Cada método se registra como `devhub:<nombre>` en ipcMain.handle.
 */
export interface DevhubApi {
  // Configuración
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  pickDirectory(): Promise<string | null>
  pickDumpFile(): Promise<string | null>

  // Puesta en marcha y servicios comunes
  runChecks(): Promise<SetupCheck[]>
  runCheckAction(actionId: string): Promise<string>
  coreStatus(): Promise<CoreStatus>
  coreUp(): Promise<string>
  coreDown(): Promise<string>

  // Integraciones
  integrations(): Promise<IntegrationStatus>
  githubStartDeviceLogin(): Promise<DeviceCode>
  githubSetToken(token: string): Promise<IntegrationStatus>
  githubLogout(): Promise<IntegrationStatus>
  googleLogin(): Promise<IntegrationStatus>
  googleLogout(): Promise<IntegrationStatus>
  setRepoHomepage(fullName: string, domain: string, writeToGithub: boolean): Promise<void>

  // Catálogo
  catalog(refresh: boolean): Promise<CatalogRow[]>
  driveSearch(term: string, everywhere: boolean): Promise<DumpFile[]>
  branches(repoFullName: string): Promise<string[]>

  // Instancias
  instances(): Promise<InstanceView[]>
  mount(req: MountRequest): Promise<string>
  start(id: string): Promise<string>
  stop(id: string): Promise<string>
  restart(id: string): Promise<string>
  remove(id: string, keepCode: boolean): Promise<string>
  duplicate(req: DuplicateRequest): Promise<string>
  changePhp(id: string, php: PhpVersion): Promise<string>
  importDb(id: string, source: MountRequest['dbSource']): Promise<string>
  setXdebug(id: string, on: boolean): Promise<string>
  resetAdmin(id: string): Promise<string>
  logs(id: string, tail: number): Promise<string>
  openUrl(url: string): Promise<void>
  openFolder(id: string): Promise<void>
  openEditor(id: string): Promise<void>
  openTerminal(id: string): Promise<void>
  snapshots(id: string): Promise<Snapshot[]>
  createSnapshot(id: string): Promise<string>
  restoreSnapshot(id: string, name: string): Promise<string>
  deleteSnapshot(id: string, name: string): Promise<void>
  pluginUpdates(id: string): Promise<PluginUpdate[]>
  runUpdates(id: string, what: 'core' | 'plugins' | string): Promise<string>
  clearCache(id: string): Promise<string>

  // Tareas
  jobs(): Promise<Job[]>
  dismissJob(id: string): Promise<void>

  appVersion(): Promise<string>
}

export type DevhubEvent =
  | { type: 'job'; job: Job }
  | { type: 'instances-changed' }
  | { type: 'github-login'; status: IntegrationStatus }

export const API_METHODS: (keyof DevhubApi)[] = [
  'getSettings',
  'saveSettings',
  'pickDirectory',
  'pickDumpFile',
  'runChecks',
  'runCheckAction',
  'coreStatus',
  'coreUp',
  'coreDown',
  'integrations',
  'githubStartDeviceLogin',
  'githubSetToken',
  'githubLogout',
  'googleLogin',
  'googleLogout',
  'setRepoHomepage',
  'catalog',
  'driveSearch',
  'branches',
  'instances',
  'mount',
  'start',
  'stop',
  'restart',
  'remove',
  'duplicate',
  'changePhp',
  'importDb',
  'setXdebug',
  'resetAdmin',
  'logs',
  'openUrl',
  'openFolder',
  'openEditor',
  'openTerminal',
  'snapshots',
  'createSnapshot',
  'restoreSnapshot',
  'deleteSnapshot',
  'pluginUpdates',
  'runUpdates',
  'clearCache',
  'jobs',
  'dismissJob',
  'appVersion'
]
