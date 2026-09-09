import { app, shell, BrowserWindow, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { listProjects, listSessions, loadConversation } from './lib/sessions'
import { initSearchIndex, searchSessions } from './lib/searchIndex'
import { deleteSession, forkSession, resumeSession, revealSession } from './lib/actions'
import { loadSettings, saveSettings } from './lib/settings'
import { listTerminals } from './lib/terminals'
import { checkForUpdate } from './lib/updater'
import {
  checkViaAutoUpdater,
  downloadUpdate,
  initAutoUpdate,
  installUpdate,
  isAutoUpdateSupported
} from './lib/autoUpdate'
import type { AppSettings, SettingsInfo, SessionProvider } from '../shared/types'

function settingsInfo(): SettingsInfo {
  return { settings: loadSettings(), terminals: listTerminals() }
}

function registerIpcHandlers(): void {
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('sessions:list', (_event, projectId: string) => listSessions(projectId))
  ipcMain.handle('conversation:load', (_event, filePath: string) => loadConversation(filePath))
  ipcMain.handle('search:query', (_event, query: string) => {
    // 프리로드가 문자열만 넘기므로 여기 오면 버그다. 빈 질의로 눌러 "결과 없음"으로
    // 위장하지 않고 렌더러까지 실패를 올려보낸다
    if (typeof query !== 'string') throw new TypeError('search:query expects a string')
    return searchSessions(query)
  })
  ipcMain.handle(
    'session:resume',
    (_event, sessionId: string, cwd: string | null, provider: SessionProvider) =>
      resumeSession(sessionId, cwd, provider)
  )
  ipcMain.handle(
    'session:fork',
    (_event, sessionId: string, cwd: string | null, provider: SessionProvider) =>
      forkSession(sessionId, cwd, provider)
  )
  ipcMain.handle('session:delete', (_event, filePath: string) => deleteSession(filePath))
  ipcMain.handle('session:reveal', (_event, filePath: string) => revealSession(filePath))
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
  })
  ipcMain.handle('update:check', (_event, force?: boolean) =>
    isAutoUpdateSupported() ? checkViaAutoUpdater() : checkForUpdate(force === true)
  )
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installUpdate())
  // 세션 우클릭 컨텍스트 메뉴 — 선택 결과('reveal'|'delete')를, 그냥 닫히면 null을 돌려준다
  ipcMain.handle(
    'session:menu',
    (event, labels: { reveal: string; delete: string; canDelete: boolean }) => {
      return new Promise<'reveal' | 'delete' | null>((resolve) => {
        let settled = false
        const done = (value: 'reveal' | 'delete' | null): void => {
          if (!settled) {
            settled = true
            resolve(value)
          }
        }
        const menu = Menu.buildFromTemplate([
          { label: String(labels?.reveal ?? 'Reveal in Finder'), click: () => done('reveal') },
          { type: 'separator' },
          {
            label: String(labels?.delete ?? 'Delete…'),
            enabled: labels?.canDelete === true,
            click: () => done('delete')
          }
        ])
        const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
        // 닫힘 콜백이 클릭 핸들러보다 먼저 올 수 있어 한 틱 늦춰 null 처리한다
        menu.popup({ window, callback: () => setTimeout(() => done(null), 100) })
      })
    }
  )
  ipcMain.handle('settings:get', () => settingsInfo())
  ipcMain.handle('settings:save', (_event, settings: Partial<AppSettings>) => {
    saveSettings(settings && typeof settings === 'object' ? settings : {})
    return settingsInfo()
  })
}

// 표준 애플리케이션 메뉴 — macOS는 앱 메뉴에, 그 외에는 File 메뉴에 설정 항목을 둔다
function buildAppMenu(): void {
  const isKo = app.getLocale().toLowerCase().startsWith('ko')
  const settingsLabel = isKo ? '설정…' : 'Settings…'
  const openSettings = (): void => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send('menu:open-settings')
  }
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: settingsLabel, accelerator: 'Cmd+,', click: openSettings },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : ([
          {
            label: isKo ? '파일' : 'File',
            submenu: [
              { label: settingsLabel, accelerator: 'Ctrl+,', click: openSettings },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#171512',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  initAutoUpdate(mainWindow)
  initSearchIndex(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 개발용 스크린샷: CHV_CAPTURE=경로 로 실행하면 첫 세션을 열어 캡처하고 종료한다
  if (process.env.CHV_CAPTURE) {
    mainWindow.webContents.on('did-finish-load', () => {
      setTimeout(async () => {
        await mainWindow.webContents.executeJavaScript(
          process.env.CHV_JS ?? `document.querySelector('.session')?.click()`
        )
        await new Promise((resolve) => setTimeout(resolve, 2500))
        if (process.env.CHV_SCROLL) {
          await mainWindow.webContents.executeJavaScript(
            `document.querySelector('.conversation__scroll')?.scrollBy(0, ${Number(process.env.CHV_SCROLL)})`
          )
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
        const image = await mainWindow.webContents.capturePage()
        await writeFile(process.env.CHV_CAPTURE as string, image.toPNG())
        app.quit()
      }, 2000)
    })
  }

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.followingseas.wake')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  buildAppMenu()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
