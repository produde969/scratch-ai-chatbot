// main.js (Electron entry file)

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// --- 1. Electron flags to maximize screenshot compatibility ---
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');
app.commandLine.appendSwitch('disable-site-isolation-trials');

let mainWindow;

function createWindow() {
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

    mainWindow.loadURL('http://localhost:8601');

    mainWindow.webContents.openDevTools();

    ipcMain.handle('capture-screenshot', async () => {
        try {
            // --- 2. Ensure rendering finishes ---
            await new Promise(resolve => setTimeout(resolve, 500));

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

