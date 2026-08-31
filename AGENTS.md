# AGENTS.md: Electron PDF.js Extensible Editor

This document serves as the master specification and execution plan for AI coding agents building this application. Follow these instructions strictly to implement the codebase.

---

## System Overview & Core Principles

You are building an **Electron-based PDF Editor** that integrates **PDF.js** as an untouched Git submodule (`vendor/pdf.js`, already initialized) and exposes a Manifest V3 WebExtension runtime API (`chrome.pdfEditor`).

### Non-Negotiable Constraints

1. **Zero Submodule Modifications:** NEVER modify, edit, or patch files inside `vendor/pdf.js`. All integration occurs externally via runtime hooks, preload scripts, and DOM overlays.
2. **Virtualization Safety:** PDF.js unloads non-visible pages from the DOM. All extension annotations and UI layers MUST be stored in memory and re-injected on `pagerendered` events.
3. **Coordinate Accuracy:** PDF coordinates use point scale (1 pt = 1/72 in) with an origin at the **bottom-left**. Web/DOM coordinates use pixels with an origin at the **top-left**. Implement bidirectional conversion math.
4. **Isolated Security:** Serve PDF.js through a custom protocol (`app-viewer://`) rather than `file://` to prevent origin security issues and enforce strict CSP compliance.

---

## Repository Structure

Construct and enforce the following file structure:

```
pdf-editor-electron/
├── package.json
├── tsconfig.json
├── vendor/
│   └── pdf.js/                  # Git submodule (UNCHANGED - initialized)
├── scripts/
│   └── build-pdfjs.js           # Submodule build & sync script
├── src/
│   ├── main/
│   │   ├── index.ts             # Electron main entry & window management
│   │   ├── extensions.ts        # MV3 extension loader & IPC bridge
│   │   └── protocol.ts          # app-viewer:// protocol handler
│   ├── preload/
│   │   └── viewer-preload.ts    # Bridge: window.PDFViewerApplication <-> Extensions
│   ├── renderer/
│   │   ├── adapter/
│   │   │   ├── event-bus.ts     # PDF.js EventBus listener maps
│   │   │   ├── overlay-manager.ts # Dynamic SVG layer injection & virtualization
│   │   │   └── viewport-math.ts   # Coordinate transformation engine
│   │   └── polyfills/
│   │       └── chrome-pdf-editor.ts # MV3 chrome.pdfEditor API polyfill
│   └── shared/
│       ├── types.ts             # IPC types and payload DTOs
│       └── pdf-merger.ts        # pdf-lib annotation flattener
└── dist/                        # Compiled output & built static assets

```

---

## Dependencies Specification

Initialize `package.json` with the following dependencies:

```json
{
  "name": "electron-pdfjs-editor",
  "version": "1.0.0",
  "main": "dist/main/index.js",
  "scripts": {
    "build:pdfjs": "node scripts/build-pdfjs.js",
    "build:ts": "tsc",
    "build": "npm run build:pdfjs && npm run build:ts",
    "start": "electron ."
  },
  "dependencies": {
    "fs-extra": "^11.2.0",
    "pdf-lib": "^1.17.1"
  },
  "devDependencies": {
    "@types/fs-extra": "^11.0.4",
    "@types/node": "^20.11.0",
    "electron": "^29.0.0",
    "typescript": "^5.3.3"
  }
}

```

---

## Task Execution Sequence

Execute the tasks sequentially. Validate completion of each phase before proceeding.

### Phase 1: Build Pipeline & Submodule Integration

#### Task 1.1: Create Submodule Build Script

Create `scripts/build-pdfjs.js` to compile the generic web distribution of PDF.js and sync assets to `dist/pdfjs`.

```javascript
// scripts/build-pdfjs.js
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const SUBMODULE_DIR = path.join(__dirname, '../vendor/pdf.js');
const OUTPUT_DIR = path.join(__dirname, '../dist/pdfjs');

console.log('[Build] Building PDF.js submodule...');
execSync('npm install && npx gulp generic', { cwd: SUBMODULE_DIR, stdio: 'inherit' });

fs.ensureDirSync(OUTPUT_DIR);
fs.copySync(path.join(SUBMODULE_DIR, 'build/generic'), OUTPUT_DIR);

console.log('[Build] Synced PDF.js assets to dist/pdfjs');

```

---

### Phase 2: Main Process & Custom Protocol Setup

#### Task 2.1: Custom Protocol Handler

Create `src/main/protocol.ts` to register `app-viewer://` to serve static files from `dist/pdfjs`.

```typescript
// src/main/protocol.ts
import { protocol } from 'electron';
import path from 'path';

export function registerViewerProtocol() {
  protocol.registerFileProtocol('app-viewer', (request, callback) => {
    const relativePath = request.url.replace('app-viewer://', '');
    const safePath = path.normalize(path.join(__dirname, '../../dist/pdfjs', relativePath));
    callback({ path: safePath });
  });
}

```

#### Task 2.2: Extension & Window Manager

Create `src/main/index.ts` to launch the browser window with MV3 extension support enabled.

```typescript
// src/main/index.ts
import { app, BrowserWindow, session } from 'electron';
import path from 'path';
import { registerViewerProtocol } from './protocol';

app.commandLine.appendSwitch('enable-features', 'BlinkExtension');

async function createWindow() {
  const pdfSession = session.fromPartition('persist:pdf-session');
  registerViewerProtocol();

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

```

---

### Phase 3: Preload Adapter & Virtualization Layer

#### Task 3.1: Preload Script

Create `src/preload/viewer-preload.ts`. Intercept PDF.js event bus calls, handle DOM virtualization re-rendering, and expose a bridge API to the renderer/content-script contexts.

```typescript
// src/preload/viewer-preload.ts
import { contextBridge, ipcRenderer } from 'electron';

interface OverlayItem {
  id: string;
  content: string;
}

interface PageOverlayState {
  pageIndex: number;
  items: OverlayItem[];
}

const overlayStore = new Map<number, PageOverlayState>();

window.addEventListener('webviewerloaded', () => {
  const App = (window as any).PDFViewerApplication;

  App.initializedPromise.then(() => {
    // 1. Re-inject overlays whenever a virtualized page renders
    App.eventBus.on('pagerendered', (evt: { pageNumber: number }) => {
      const pageIndex = evt.pageNumber;
      const pageView = App.pdfViewer.getPageView(pageIndex - 1);
      if (!pageView) return;

      const pageDiv = pageView.div as HTMLElement;
      let layer = pageDiv.querySelector('.ext-overlay-layer') as HTMLElement;

      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'ext-overlay-layer';
        layer.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;';
        pageDiv.appendChild(layer);
      }

      if (overlayStore.has(pageIndex)) {
        layer.innerHTML = '';
        overlayStore.get(pageIndex)!.items.forEach(item => {
          const wrapper = document.createElement('div');
          wrapper.id = item.id;
          wrapper.innerHTML = item.content;
          layer.appendChild(wrapper);
        });
      }

      window.postMessage({
        type: 'PDF_PAGE_RENDERED',
        payload: {
          pageNumber: pageIndex,
          scale: App.pdfViewer.currentScale,
          viewport: pageView.viewport
        }
      }, '*');
    });
  });
});

contextBridge.exposeInMainWorld('__PDF_ADAPTER__', {
  addAnnotation: (pageIndex: number, annotation: OverlayItem) => {
    if (!overlayStore.has(pageIndex)) {
      overlayStore.set(pageIndex, { pageIndex, items: [] });
    }
    overlayStore.get(pageIndex)!.items.push(annotation);

    const App = (window as any).PDFViewerApplication;
    const pageView = App.pdfViewer.getPageView(pageIndex - 1);
    if (pageView && pageView.renderingState === 3) {
      App.eventBus.dispatch('pagerendered', { pageNumber: pageIndex });
    }
  },
  getPDFBytes: async (): Promise<Uint8Array> => {
    const App = (window as any).PDFViewerApplication;
    return await App.pdfDocument.saveDocument();
  }
});

```

---

### Phase 4: Geometry & Export Engines

#### Task 4.1: Viewport Math Transformer

Create `src/renderer/adapter/viewport-math.ts` to convert coordinates between DOM pixel space and native PDF point space.

```typescript
// src/renderer/adapter/viewport-math.ts

export interface PDFPoint { x: number; y: number; }
export interface DOMPoint { left: number; top: number; }

/** Converts PDF Point (bottom-left origin, points) to DOM Pixel (top-left origin, pixels) */
export function pdfToDomCoordinates(pt: PDFPoint, pageHeightPoints: number, scale: number): DOMPoint {
  return {
    left: pt.x * scale,
    top: (pageHeightPoints - pt.y) * scale
  };
}

/** Converts DOM Pixel (top-left origin, pixels) to PDF Point (bottom-left origin, points) */
export function domToPdfCoordinates(pt: DOMPoint, pageHeightPoints: number, scale: number): PDFPoint {
  return {
    x: pt.left / scale,
    y: pageHeightPoints - (pt.top / scale)
  };
}

```

#### Task 4.2: Document Flattener

Create `src/shared/pdf-merger.ts` using `pdf-lib` to write vector annotations back to the output PDF document stream upon save.

```typescript
// src/shared/pdf-merger.ts
import { PDFDocument, rgb } from 'pdf-lib';

export interface PDFAnnotationRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: { r: number; g: number; b: number };
}

export async function mergeAnnotationsToPDF(
  originalPdfBytes: Uint8Array,
  annotations: PDFAnnotationRect[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    const page = pages[ann.pageIndex - 1];
    if (!page) continue;

    page.drawRectangle({
      x: ann.x,
      y: ann.y,
      width: ann.width,
      height: ann.height,
      color: rgb(ann.color.r, ann.color.g, ann.color.b),
      opacity: 0.4
    });
  }

  return await pdfDoc.save();
}

```

---

### Phase 5: WebExtension Polyfill

#### Task 5.1: `chrome.pdfEditor` API Runtime

Create `src/renderer/polyfills/chrome-pdf-editor.ts` to expose the extension interface inside WebExtension contexts.

```typescript
// src/renderer/polyfills/chrome-pdf-editor.ts

export const chromePdfEditor = {
  onPageRendered: (callback: (data: { pageNumber: number; scale: number }) => void) => {
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'PDF_PAGE_RENDERED') {
        callback(event.data.payload);
      }
    });
  },

  addHighlight: (pageNumber: number, rect: { x: number; y: number; width: number; height: number; color: string }) => {
    const svgContent = `
      <svg style="position:absolute; width:100%; height:100%; top:0; left:0;">
        <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" 
              fill="${rect.color}" fill-opacity="0.4" />
      </svg>
    `;
    (window as any).__PDF_ADAPTER__.addAnnotation(pageNumber, {
      id: `highlight-${Date.now()}-${Math.random()}`,
      content: svgContent
    });
  },

  exportDocument: async (): Promise<Uint8Array> => {
    return await (window as any).__PDF_ADAPTER__.getPDFBytes();
  }
};

```

---

## Verification & Validation Protocol

Agent must run the following checks to confirm application stability:

1. **Build Check:**
```bash
npm run build

```


*Verify:* Confirm `dist/pdfjs/web/viewer.html` exists and TypeScript compilation exits with code `0`.
2. **Launch Check:**
```bash
npm run start

```


*Verify:* Electron window opens, PDF.js viewer renders without console security errors or protocol failure notices.
3. **Virtualization Test:**
Scroll through a multi-page PDF document. Verify that `.ext-overlay-layer` element persists and re-renders dynamically as pages scroll in and out of view.
4. **Coordinate Accuracy Test:**
Pass an annotation rectangle through `domToPdfCoordinates` and back through `pdfToDomCoordinates`. Verify spatial parity within a $\pm 0.01\text{px}$ tolerance.
