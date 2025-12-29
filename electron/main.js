// main.js (Electron entry) — paste-over

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

////////////////////////////////////////////////////////////////////////////////
// 0) Command-line flags (before app is ready)
////////////////////////////////////////////////////////////////////////////////
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');
app.commandLine.appendSwitch('disable-site-isolation-trials');

////////////////////////////////////////////////////////////////////////////////
// 1) Menus: enable native Copy/Paste + context menu
////////////////////////////////////////////////////////////////////////////////
const isMac = process.platform === 'darwin';

function installAppMenus() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        ...(isMac
          ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' },
             { type: 'separator' }, { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }] : [{ role: 'close' }])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installContextMenu(win) {
  win.webContents.on('context-menu', (_event, params) => {
    const { isEditable, selectionText } = params;
    const hasText = !!(selectionText && selectionText.trim());
    const template = [
      ...(isEditable ? [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }] : []),
      ...(hasText ? [{ role: 'copy' }] : []),
      ...(isEditable
        ? [{ role: 'cut' }, { role: 'paste' }, { role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]
        : hasText ? [{ type: 'separator' }, { role: 'selectAll' }] : [])
    ];
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });
}

////////////////////////////////////////////////////////////////////////////////
// 2) Quiet DevTools Autofill.* spam in app logs (terminal may still show it)
////////////////////////////////////////////////////////////////////////////////
function quietDevToolsAutofill(win) {
  const attachConsoleFilter = (wc) => {
    wc.on('console-message', (event, ...args) => {
      // New signature: (event, paramsObj); Old: (event, level, message, line, sourceId)
      let message, sourceId;
      if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        const params = args[0];
        message = params.message;
        sourceId = params.sourceId;
      } else {
        const [, msg, , src] = args;
        message = msg;
        sourceId = src;
      }
      const fromDevtools = sourceId && String(sourceId).startsWith('devtools://');
      if (fromDevtools && String(message).includes('Autofill.')) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
      }
    });
  };

  attachConsoleFilter(win.webContents);
  win.webContents.on('devtools-opened', () => {
    const devtoolsWC = win.webContents.getDevToolsWebContents
      ? win.webContents.getDevToolsWebContents()
      : win.webContents.devToolsWebContents;
    if (devtoolsWC) attachConsoleFilter(devtoolsWC);
  });
}

////////////////////////////////////////////////////////////////////////////////
// 3) Native typing helpers (IPC): insertText + pressEnter + paste
////////////////////////////////////////////////////////////////////////////////
ipcMain.handle('insert-text', (_evt, text) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win && typeof text === 'string') {
    win.webContents.insertText(text);
    return true;
  }
  return false;
});

ipcMain.handle('press-enter', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    // Send a trusted Enter key to whichever element has focus
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'Enter' });
    return true;
  }
  return false;
});

ipcMain.handle('paste-focused', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    if (typeof win.webContents.paste === 'function') {
      win.webContents.paste();
    } else {
      // Fallback: Ctrl/Cmd+V
      const mod = process.platform === 'darwin' ? 'meta' : 'control';
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'v', modifiers: [mod] });
      win.webContents.sendInputEvent({ type: 'keyUp',   keyCode: 'v', modifiers: [mod] });
    }
    return true;
  }
  return false;
});

////////////////////////////////////////////////////////////////////////////////
// 4) Window & screenshot IPC
////////////////////////////////////////////////////////////////////////////////
let mainWindow;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      offscreen: false
    }
  });

  installContextMenu(mainWindow);
  quietDevToolsAutofill(mainWindow);

  await mainWindow.loadURL('http://localhost:8601');

  // Open DevTools on demand via View menu; auto-open tends to print Autofill spam to terminal
  // mainWindow.webContents.openDevTools();

  // Screenshot handler
  ipcMain.handle('capture-screenshot', async () => {
    try {
      await new Promise(r => setTimeout(r, 500));
      const image = await mainWindow.webContents.capturePage();
      const buffer = image.toPNG();
      const screenshotPath = path.join(app.getPath('userData'), 'screenshot.png');
      fs.writeFileSync(screenshotPath, buffer);
      return screenshotPath;
    } catch (err) {
      console.error('Screenshot failed:', err);
      return null;
    }
  });
}

////////////////////////////////////////////////////////////////////////////////
// 5) App lifecycle
////////////////////////////////////////////////////////////////////////////////
app.whenReady().then(() => {
  installAppMenus();
  createWindow();

  app.on('browser-window-created', (_evt, win) => {
    installContextMenu(win);
    quietDevToolsAutofill(win);
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    installAppMenus();
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
