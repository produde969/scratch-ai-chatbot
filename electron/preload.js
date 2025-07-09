// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    captureScreenshot: () => ipcRenderer.invoke('capture-screenshot')
});

