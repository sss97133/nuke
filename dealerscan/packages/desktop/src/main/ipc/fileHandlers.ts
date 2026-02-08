import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

export function registerFileHandlers() {
  // Check if chat.db is accessible (Full Disk Access check for macOS)
  ipcMain.handle('check-full-disk-access', async () => {
    if (process.platform !== 'darwin') return true

    const chatDbPath = path.join(
      process.env.HOME || '',
      'Library/Messages/chat.db'
    )

    try {
      fs.accessSync(chatDbPath, fs.constants.R_OK)
      return true
    } catch {
      return false
    }
  })
}
