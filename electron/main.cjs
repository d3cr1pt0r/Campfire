const { app, BrowserWindow, session, desktopCapturer, dialog, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const { createRendererServer } = require('./renderer-server.cjs');
const { createClientState } = require('./client-state.cjs');
app.setAppUserModelId('org.driskord.desktop');
let assetServer;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    const clientState = createClientState(app.getPath('userData'), safeStorage);
    assetServer = createRendererServer(path.join(__dirname, '..', 'dist'));
    await new Promise((resolve, reject) => { assetServer.once('error', reject); assetServer.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${assetServer.address().port}`;
    const trusted = url => { try { return new URL(url).origin === origin; } catch { return false; } };
    ipcMain.on('client-state:get', (event, key) => { event.returnValue = trusted(event.senderFrame?.url) ? clientState.get(key) : null; });
    ipcMain.on('client-state:set', (event, key, value) => {
      try { event.returnValue = trusted(event.senderFrame?.url) && clientState.set(key, value); }
      catch { event.returnValue = false; }
    });
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(trusted(wc?.getURL()) && ['media', 'display-capture', 'notifications'].includes(permission)));
    session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => trusted(requestingOrigin) && ['media', 'display-capture', 'notifications'].includes(permission));
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        if (!trusted(request.frame?.url)) return callback({});
        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
        const result = await dialog.showMessageBox({ type: 'question', title: 'Share a screen or window', message: 'Choose what to share', buttons: [...sources.map(s => s.name), 'Cancel'], cancelId: sources.length, noLink: true });
        if (result.response >= sources.length) return callback({});
        callback({ video: sources[result.response] });
      } catch { callback({}); }
    }, { useSystemPicker: true });
    const open = () => {
      const win = new BrowserWindow({ width: 1440, height: 940, minWidth: 960, minHeight: 640, title: 'Driskord', backgroundColor: '#18191f', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
      void win.loadURL(origin);
    };
    open();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) open(); });
  }).catch(error => { dialog.showErrorBox('Driskord could not start', error.message); app.quit(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { assetServer?.close(); });
