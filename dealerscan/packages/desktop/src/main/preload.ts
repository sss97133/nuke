import { contextBridge, ipcRenderer } from 'electron'

export interface FileInfo {
  name: string
  path: string
  ext: string
  size: number
}

export interface FileBuffer {
  buffer: string // base64
  name: string
  type: string
  size: number
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Folder operations
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('select-folder'),
  readFilesInFolder: (folderPath: string): Promise<FileInfo[]> =>
    ipcRenderer.invoke('read-files-in-folder', folderPath),
  readFileAsBuffer: (filePath: string): Promise<FileBuffer> =>
    ipcRenderer.invoke('read-file-as-buffer', filePath),

  // Auth store
  getAuthToken: (): Promise<string | null> =>
    ipcRenderer.invoke('auth-get-token'),
  setAuthToken: (token: string): Promise<void> =>
    ipcRenderer.invoke('auth-set-token', token),
  clearAuthToken: (): Promise<void> =>
    ipcRenderer.invoke('auth-clear-token'),
  getStoredConfig: (): Promise<{ supabaseUrl: string; supabaseAnonKey: string } | null> =>
    ipcRenderer.invoke('auth-get-config'),
  setStoredConfig: (config: { supabaseUrl: string; supabaseAnonKey: string }): Promise<void> =>
    ipcRenderer.invoke('auth-set-config', config),

  // External links
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  // App info
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke('get-app-version'),
  isElectron: (): Promise<boolean> =>
    ipcRenderer.invoke('is-electron'),

  // Deep link listener
  onDeepLink: (callback: (url: string) => void) => {
    const handler = (_event: any, url: string) => callback(url)
    ipcRenderer.on('deep-link', handler)
    return () => ipcRenderer.removeListener('deep-link', handler)
  },

  // iMessage permissions check (macOS)
  checkFullDiskAccess: (): Promise<boolean> =>
    ipcRenderer.invoke('check-full-disk-access'),
})
