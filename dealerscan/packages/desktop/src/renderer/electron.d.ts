interface FileInfo {
  name: string
  path: string
  ext: string
  size: number
}

interface FileBuffer {
  buffer: string // base64
  name: string
  type: string
  size: number
}

interface ElectronAPI {
  selectFolder(): Promise<string | null>
  readFilesInFolder(folderPath: string): Promise<FileInfo[]>
  readFileAsBuffer(filePath: string): Promise<FileBuffer>
  getAuthToken(): Promise<string | null>
  setAuthToken(token: string): Promise<void>
  clearAuthToken(): Promise<void>
  getStoredConfig(): Promise<{ supabaseUrl: string; supabaseAnonKey: string } | null>
  setStoredConfig(config: { supabaseUrl: string; supabaseAnonKey: string }): Promise<void>
  openExternal(url: string): Promise<void>
  getAppVersion(): Promise<string>
  isElectron(): Promise<boolean>
  onDeepLink(callback: (url: string) => void): () => void
  checkFullDiskAccess(): Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
