// src/preload/viewer-preload.ts
// Preload bridge between Electron main and the PDF.js viewer (main world).
// SEC-6 fix: no eval(), no webFrame.executeJavaScript(string) with inline template.
// Polyfills are imported as a typed module and applied directly; main-world logic
// is compiled separately to dist/renderer/viewer-main-world.js and injected via
// the custom protocol's viewer.html rewrite (see src/main/protocol.ts –
// injectViewerMainWorldScript). This makes the code lintable, type-checked,
// and CSP-compatible while preserving text-editing functionality.

import { contextBridge, ipcRenderer } from 'electron';
import { applyPolyfills } from '../renderer/polyfills/polyfills';

// Expose IPC bridge for text editing (used by the main-world script via window.__PDF_TEXT_EDITOR_IPC__)
contextBridge.exposeInMainWorld('__PDF_TEXT_EDITOR_IPC__', {
  apply: (originalPdfBytes: Uint8Array, edits: unknown[]) =>
    ipcRenderer.invoke('pdf:apply-text-edits', originalPdfBytes, edits),
});

// Apply polyfills in the isolated preload world (feature-detected, see polyfills.ts).
// This ensures the preload's own runtime (btoa/atob, Promise.try, etc.) is patched safely.
applyPolyfills();
