import { contextBridge, ipcRenderer } from 'electron'
import type { SessionHistoryApi, SearchProgress, UpdateEvent } from '../shared/types'

const api: SessionHistoryApi = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  listSessions: (projectId) => ipcRenderer.invoke('sessions:list', projectId),
  loadConversation: (filePath) => ipcRenderer.invoke('conversation:load', filePath),
  searchSessions: (query) => ipcRenderer.invoke('search:query', query),
  resumeSession: (sessionId, cwd, provider) =>
    ipcRenderer.invoke('session:resume', sessionId, cwd, provider),
  forkSession: (sessionId, cwd, provider) =>
    ipcRenderer.invoke('session:fork', sessionId, cwd, provider),
  deleteSession: (filePath) => ipcRenderer.invoke('session:delete', filePath),
  revealSession: (filePath) => ipcRenderer.invoke('session:reveal', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  checkForUpdate: (force) => ipcRenderer.invoke('update:check', force),
  onUpdateEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UpdateEvent): void =>
      callback(payload)
    ipcRenderer.on('update:event', listener)
    return () => ipcRenderer.removeListener('update:event', listener)
  },
  onOpenSettings: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('menu:open-settings', listener)
    return () => ipcRenderer.removeListener('menu:open-settings', listener)
  },
  onSearchProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SearchProgress): void =>
      callback(payload)
    ipcRenderer.on('search:progress', listener)
    return () => ipcRenderer.removeListener('search:progress', listener)
  },
  showSessionMenu: (labels) => ipcRenderer.invoke('session:menu', labels),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
