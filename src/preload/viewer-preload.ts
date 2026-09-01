// src/preload/viewer-preload.ts
// Preload bridge between Electron main and the PDF.js viewer (main world).
// SEC-6 fix: no eval(), no webFrame.executeJavaScript(string) with inline template.
// Polyfills are imported as a typed module and applied directly; main-world logic
// is compiled separately to dist/renderer/viewer-main-world.js and injected via
// a <script> tag served through the app-viewer:// protocol (see src/renderer/viewer-main-world.ts
// and src/main/protocol.ts). This makes the code lintable, type-checked, and CSP-compatible.

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

// Inject the main-world integration script as a plain <script> tag rather than via
// webFrame.executeJavaScript(string) / eval. The script is compiled by tsc to
// dist/renderer/viewer-main-world.js and served via app-viewer://web/renderer/viewer-main-world.js
// (same origin as viewer.html so CSP 'self' allows it, see protocol.ts).
function injectMainWorldScript(): void {
  // Avoid double-injection.
  if (document.getElementById('viewer-main-world-script')) return;

  const script = document.createElement('script');
  script.id = 'viewer-main-world-script';
  script.src = 'app-viewer://web/renderer/viewer-main-world.js';
  script.async = false;

  script.onerror = () => {
    console.error('[preload] Failed to load viewer-main-world.js via app-viewer://web/renderer/');
  };

  // Ensure head exists; document may still be loading when this preload runs.
  const target = document.head || document.documentElement;
  if (target) {
    target.appendChild(script);
  } else {
    // Fallback: wait for DOMContentLoaded if document not yet parsed.
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        if (!document.getElementById('viewer-main-world-script')) {
          (document.head || document.documentElement).appendChild(script);
        }
      },
      { once: true }
    );
  }
}

// Electron's preload runs before the viewer's DOM is fully built, so we try both
// immediate injection (if document.head exists) and deferred via events.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectMainWorldScript, { once: true });
  window.addEventListener('DOMContentLoaded', injectMainWorldScript, { once: true });
  // Also attempt immediate in case head already exists despite loading state.
  if (document.head) injectMainWorldScript();
} else {
  injectMainWorldScript();
}

// Also inject on window 'load' as a safety net for late viewer.html fetches.
window.addEventListener('load', injectMainWorldScript, { once: true });
