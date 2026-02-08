import { ipcMain } from 'electron'
import Store from 'electron-store'

interface AuthStoreSchema {
  refreshToken: string | null
  supabaseUrl: string | null
  supabaseAnonKey: string | null
}

const store = new Store<AuthStoreSchema>({
  name: 'dealerscan-auth',
  encryptionKey: 'dealerscan-desktop-v1',
  defaults: {
    refreshToken: null,
    supabaseUrl: null,
    supabaseAnonKey: null,
  },
})

export function registerAuthStore() {
  ipcMain.handle('auth-get-token', () => {
    return store.get('refreshToken')
  })

  ipcMain.handle('auth-set-token', (_event, token: string) => {
    store.set('refreshToken', token)
  })

  ipcMain.handle('auth-clear-token', () => {
    store.set('refreshToken', null)
  })

  ipcMain.handle('auth-get-config', () => {
    const url = store.get('supabaseUrl')
    const key = store.get('supabaseAnonKey')
    if (!url || !key) return null
    return { supabaseUrl: url, supabaseAnonKey: key }
  })

  ipcMain.handle('auth-set-config', (_event, config: { supabaseUrl: string; supabaseAnonKey: string }) => {
    store.set('supabaseUrl', config.supabaseUrl)
    store.set('supabaseAnonKey', config.supabaseAnonKey)
  })
}
