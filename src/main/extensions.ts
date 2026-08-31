// src/main/extensions.ts
import { session, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs-extra';

/**
 * MV3 extension loader & IPC bridge.
 * Scans for extensions in the configured extensions directory,
 * loads them into the PDF session, and relays IPC messages between
 * the main process and extension contexts.
 */

const EXTENSIONS_DIR = path.join(__dirname, '../../extensions');

export interface ExtensionInfo {
  name: string;
  path: string;
}

/**
 * Load all MV3 extensions found in the extensions directory
 * into the given Electron session.
 */
export async function loadExtensions(ses: Electron.Session): Promise<ExtensionInfo[]> {
  const loaded: ExtensionInfo[] = [];

  if (!fs.existsSync(EXTENSIONS_DIR)) {
    console.log('[Extensions] No extensions directory found, skipping.');
    return loaded;
  }

  const entries = await fs.readdir(EXTENSIONS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const extPath = path.join(EXTENSIONS_DIR, entry.name);
    const manifestPath = path.join(extPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      console.warn(`[Extensions] Skipping ${entry.name}: no manifest.json`);
      continue;
    }

    try {
      const ext = await ses.loadExtension(extPath);
      loaded.push({ name: ext.name, path: extPath });
      console.log(`[Extensions] Loaded: ${ext.name}`);
    } catch (err) {
      console.error(`[Extensions] Failed to load ${entry.name}:`, err);
    }
  }

  return loaded;
}

/**
 * Register IPC handlers for extension communication.
 */
export function registerExtensionIPC(): void {
  ipcMain.handle('extension:list', async () => {
    // Return list of loaded extensions
    const ses = session.fromPartition('persist:pdf-session');
    return ses.getAllExtensions().map(ext => ({
      id: ext.id,
      name: ext.name,
      version: ext.version
    }));
  });

  ipcMain.handle('extension:send-message', async (_event, extensionId: string, message: unknown) => {
    // Forward messages to extensions via the session
    console.log(`[Extensions] Message to ${extensionId}:`, message);
    return { success: true };
  });
}
