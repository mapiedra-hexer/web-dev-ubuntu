import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { API_METHODS, type DevhubApi } from '@shared/api'
import { isDomain, normalizeDomain } from '@shared/domain'
import type { IntegrationStatus } from '@shared/types'
import { emit } from './events'
import { dismissJob, listJobs, startJob } from './jobs'
import { readSecrets, writeSecrets } from './secrets'
import { getSettings, saveSettings } from './store'
import { catalog, invalidateCatalog } from './catalog'
import { coreDown, coreStatus, coreUp } from './core/core'
import { runCheckAction, runChecks } from './setup/checks'
import { githubClientId, githubUser, setHomepage, startDeviceLogin } from './integrations/github'
import { googleConfigured, googleConnected, googleEmail, googleLogin, googleLogout, searchDumps } from './integrations/drive'
import * as instances from './instances/manager'

async function integrations(): Promise<IntegrationStatus> {
  const secrets = readSecrets()
  const github: IntegrationStatus['github'] = { connected: false, clientIdConfigured: !!githubClientId() }
  if (secrets.githubToken) {
    try {
      github.login = await githubUser(secrets.githubToken)
      github.connected = true
    } catch (e) {
      github.error = (e as Error).message
    }
  }
  const google: IntegrationStatus['google'] = { connected: false, clientIdConfigured: googleConfigured() }
  if (googleConnected()) {
    try {
      google.email = await googleEmail()
      google.connected = true
    } catch (e) {
      google.error = (e as Error).message
    }
  }
  return { github, google }
}

async function branches(repoFullName: string): Promise<string[]> {
  const token = readSecrets().githubToken
  if (!token) return []
  const res = await fetch(`https://api.github.com/repos/${repoFullName}/branches?per_page=100`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'devhub' }
  })
  if (!res.ok) return []
  return ((await res.json()) as { name: string }[]).map((b) => b.name)
}

const api: DevhubApi = {
  getSettings: async () => getSettings(),
  saveSettings: async (patch) => {
    const s = saveSettings(patch)
    invalidateCatalog()
    return s
  },
  pickDirectory: async () => {
    const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  },
  pickDumpFile: async () => {
    const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow()!, {
      properties: ['openFile'],
      filters: [{ name: 'Volcados SQL', extensions: ['sql', 'gz', 'zip'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  },

  runChecks: () => runChecks(),
  runCheckAction: async (id) =>
    startJob(`Puesta en marcha: ${id}`, async (ctx) => {
      ctx.log(await runCheckAction(id, ctx.log))
    }),
  coreStatus: () => coreStatus(),
  coreUp: async () => startJob('Arrancar servicios comunes', (ctx) => coreUp(ctx.log)),
  coreDown: async () => startJob('Parar servicios comunes', (ctx) => coreDown(ctx.log)),

  integrations,
  githubStartDeviceLogin: async () => {
    const code = await startDeviceLogin(async () => {
      invalidateCatalog()
      emit({ type: 'github-login', status: await integrations() })
    })
    void shell.openExternal(code.verificationUri)
    return code
  },
  githubSetToken: async (token) => {
    await githubUser(token.trim())
    writeSecrets({ githubToken: token.trim() })
    invalidateCatalog()
    return integrations()
  },
  githubLogout: async () => {
    writeSecrets({ githubToken: undefined })
    invalidateCatalog()
    return integrations()
  },
  googleLogin: async () => {
    await googleLogin()
    invalidateCatalog()
    return integrations()
  },
  googleLogout: async () => {
    googleLogout()
    invalidateCatalog()
    return integrations()
  },
  setRepoHomepage: async (fullName, domain, writeToGithub) => {
    const d = normalizeDomain(domain)
    if (!isDomain(d)) throw new Error(`Dominio no válido: ${domain}`)
    saveSettings({ domainOverrides: { ...getSettings().domainOverrides, [fullName]: d } })
    if (writeToGithub) await setHomepage(fullName, `https://${d}`)
  },

  catalog: (refresh) => catalog(refresh),
  driveSearch: (term, everywhere) => searchDumps(term, everywhere),
  branches,

  instances: () => instances.listViews(),
  mount: async (req) => instances.mount(req),
  start: async (id) => instances.start(id),
  stop: async (id) => instances.stop(id),
  restart: async (id) => instances.restart(id),
  remove: async (id, keepCode) => instances.remove(id, keepCode),
  duplicate: async (req) => instances.duplicate(req),
  changePhp: async (id, php) => instances.changePhp(id, php),
  importDb: async (id, source) => instances.importDb(id, source),
  setXdebug: async (id, on) => instances.setXdebug(id, on),
  resetAdmin: async (id) => instances.resetAdmin(id),
  logs: (id, tail) => instances.logs(id, tail),
  openUrl: async (url) => {
    if (!/^https?:\/\//.test(url)) throw new Error('URL no permitida')
    await shell.openExternal(url)
  },
  openFolder: (id) => instances.openFolder(id),
  openEditor: (id) => instances.openEditor(id),
  openTerminal: (id) => instances.openTerminal(id),
  snapshots: async (id) => instances.listSnapshots(id),
  createSnapshot: async (id) => instances.createSnapshot(id),
  restoreSnapshot: async (id, name) => instances.restoreSnapshot(id, name),
  deleteSnapshot: async (id, name) => instances.deleteSnapshot(id, name),
  pluginUpdates: (id) => instances.pluginUpdates(id),
  runUpdates: async (id, what) => instances.runUpdates(id, what),
  clearCache: async (id) => instances.clearCache(id),

  jobs: async () => listJobs(),
  dismissJob: async (id) => dismissJob(id),
  appVersion: async () => app.getVersion()
}

export function registerIpc(): void {
  for (const name of API_METHODS) {
    const fn = api[name] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(`devhub:${name}`, (_event, ...args: unknown[]) => fn(...args))
  }
}
