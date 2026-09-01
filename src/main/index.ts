// src/main/index.ts
import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import { registerViewerScheme, registerViewerProtocol } from './protocol';
import { applyTextEditsToPDF } from '../shared/text-editor';
import { assertValidTextEdits, MAX_TEXT_EDITS } from '../shared/types';
import type { PDFTextEdit } from '../shared/types';

app.commandLine.appendSwitch('enable-features', 'BlinkExtension');

// Must register custom scheme privileges BEFORE app is ready
registerViewerScheme();

ipcMain.handle(
  'pdf:apply-text-edits',
  async (_event, originalPdfBytes: Uint8Array, edits: PDFTextEdit[]): Promise<Uint8Array> => {
    if (!(originalPdfBytes instanceof Uint8Array)) {
      throw new TypeError('Expected source PDF bytes to be a Uint8Array');
    }
    if (!Array.isArray(edits)) {
      throw new TypeError('Expected text edits to be an array');
    }
    if (edits.length > MAX_TEXT_EDITS) {
      throw new TypeError(`Too many text edits: ${edits.length} exceeds maximum of ${MAX_TEXT_EDITS}`);
    }
    assertValidTextEdits(edits);
    return applyTextEditsToPDF(originalPdfBytes, edits);
  }
);

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
      sandbox: true
    }
  });

  mainWindow.loadURL('app-viewer://web/viewer.html');
}

app.whenReady().then(createWindow);
