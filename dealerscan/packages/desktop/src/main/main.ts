import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron'
import path from 'path'
import fs from 'fs'
import { registerFileHandlers } from './ipc/fileHandlers'
import { registerAuthStore } from './ipc/authStore'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

let mainWindow: BrowserWindow | null = null

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.pdf', '.tiff', '.tif']

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    )
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Handle deep links (dealerscan:// protocol)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('dealerscan', process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient('dealerscan')
}

// macOS: handle protocol URLs
app.on('open-url', (_event, url) => {
  if (mainWindow) {
    mainWindow.webContents.send('deep-link', url)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // Handle deep link from second instance (Windows)
    const url = commandLine.find(arg => arg.startsWith('dealerscan://'))
    if (url && mainWindow) {
      mainWindow.webContents.send('deep-link', url)
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  registerFileHandlers()
  registerAuthStore()

  // IPC: Select folder
  ipcMain.handle('select-folder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select folder with dealer jacket photos',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // IPC: Read files in folder
  ipcMain.handle('read-files-in-folder', async (_event, folderPath: string) => {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    const files = entries
      .filter(e => {
        if (!e.isFile()) return false
        const ext = path.extname(e.name).toLowerCase()
        return SUPPORTED_EXTENSIONS.includes(ext)
      })
      .map(e => ({
        name: e.name,
        path: path.join(folderPath, e.name),
        ext: path.extname(e.name).toLowerCase(),
        size: fs.statSync(path.join(folderPath, e.name)).size,
      }))
    return files
  })

  // IPC: Read file as buffer (for upload)
  ipcMain.handle('read-file-as-buffer', async (_event, filePath: string) => {
    const buffer = fs.readFileSync(filePath)
    const ext = path.extname(filePath).toLowerCase()
    const name = path.basename(filePath)
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.heic': 'image/heic',
      '.pdf': 'application/pdf',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff',
    }
    return {
      buffer: buffer.toString('base64'),
      name,
      type: mimeTypes[ext] || 'application/octet-stream',
      size: buffer.length,
    }
  })

  // IPC: Open external URL (for Stripe checkout)
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  // IPC: Get app version
  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  // IPC: Check if running in Electron
  ipcMain.handle('is-electron', () => true)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
