// scripts/verify-electron.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { registerViewerScheme, registerViewerProtocol } = require('../dist/main/protocol');

app.commandLine.appendSwitch('enable-features', 'BlinkExtension');
app.commandLine.appendSwitch('disable-gpu');

registerViewerScheme();

async function runTest() {
  const pdfSession = session.fromPartition('persist:pdf-session');
  registerViewerProtocol();
  registerViewerProtocol(pdfSession);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      session: pdfSession,
      preload: path.join(__dirname, '../dist/preload/viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message}`);
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`❌ Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`);
    app.quit();
    process.exit(1);
  });

  win.webContents.on('did-finish-load', async () => {
    console.log('✅ Page loaded successfully: app-viewer://web/viewer.html');

    try {
      const result = await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const check = () => {
            const hasAdapter = typeof window.__PDF_ADAPTER__ !== 'undefined';
            const hasPDFApp = typeof window.PDFViewerApplication !== 'undefined';
            if (hasAdapter && hasPDFApp && window.PDFViewerApplication.initialized) {
              resolve({ success: true, hasAdapter, hasPDFApp, appInitialized: true });
            } else {
              setTimeout(check, 100);
            }
          };
          check();
          setTimeout(() => resolve({
            success: false,
            hasAdapter: typeof window.__PDF_ADAPTER__ !== 'undefined',
            hasPDFApp: typeof window.PDFViewerApplication !== 'undefined',
            appInitialized: typeof window.PDFViewerApplication !== 'undefined' ? window.PDFViewerApplication.initialized : false
          }), 5000);
        })
      `);

      console.log('Verification result:', JSON.stringify(result, null, 2));
      if (result.hasAdapter && result.hasPDFApp) {
        console.log('✅ Integration check PASSED: __PDF_ADAPTER__ and PDFViewerApplication present and initialized!');
        app.quit();
        process.exit(0);
      } else {
        console.error('❌ Integration check FAILED:', result);
        app.quit();
        process.exit(1);
      }
    } catch (err) {
      console.error('❌ executeJavaScript error:', err);
      app.quit();
      process.exit(1);
    }
  });

  await win.loadURL('app-viewer://web/viewer.html');
}

app.whenReady().then(runTest);
