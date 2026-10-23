import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type DevhubApi, type DevhubEvent } from '@shared/api'

const api = Object.fromEntries(
  API_METHODS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(`devhub:${name}`, ...args)])
) as unknown as DevhubApi

contextBridge.exposeInMainWorld('devhub', api)
contextBridge.exposeInMainWorld('devhubEvents', {
  on(cb: (e: DevhubEvent) => void): () => void {
    const listener = (_: unknown, e: DevhubEvent): void => cb(e)
    ipcRenderer.on('devhub:event', listener)
    return () => ipcRenderer.removeListener('devhub:event', listener)
  }
})
