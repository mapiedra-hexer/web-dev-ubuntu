import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { autoUpdater } from 'electron-updater'
import { bus, emit } from './events'
import { ensureDirs, setResourcesRoot } from './paths'
import { registerIpc } from './ipc'
import { watchContainerEvents } from './docker'

// En el .deb, core/, images/ y build/privileged.sh van en resources/ (extraResources).
setResourcesRoot(app.isPackaged ? process.resourcesPath : app.getAppPath())
ensureDirs()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'DevHub',
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })
  // Los enlaces externos se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    registerIpc()
    bus.on('event', (event) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('devhub:event', event)
    })
    const stopWatching = watchContainerEvents(() => emit({ type: 'instances-changed' }))
    app.on('will-quit', stopWatching)
    createWindow()
    if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  })

  app.on('window-all-closed', () => app.quit())
}
