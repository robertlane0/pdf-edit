// src/main/index.ts
import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { registerViewerScheme, registerViewerProtocol } from './protocol';

app.commandLine.appendSwitch('enable-features', 'BlinkExtension');

// Must register custom scheme privileges BEFORE app is ready
registerViewerScheme();

async function createWindow() {
  const pdfSession = session.fromPartition('persist:pdf-session');

  // Register the protocol handler on BOTH the default session and the PDF session
  // to ensure the custom scheme works regardless of which session handles the request
  registerViewerProtocol();
  registerViewerProtocol(pdfSession);

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      session: pdfSession,
      preload: path.join(__dirname, '../preload/viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadURL('app-viewer://web/viewer.html');
}

app.whenReady().then(createWindow);
