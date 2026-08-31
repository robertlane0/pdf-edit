// src/preload/viewer-preload.ts
import { webFrame } from 'electron';

/**
 * Polyfills for modern web standards (TC39 proposals / Baseline 2024-2025)
 * required by PDF.js v5+ in Electron's Chromium runtime, across both
 * window and Web Worker execution contexts.
 */
const polyfillSource = `
  // 1. Math.sumPrecise (TC39 Stage 3)
  if (typeof Math.sumPrecise !== 'function') {
    Math.sumPrecise = function(iterable) {
      let sum = 0;
      for (const num of iterable) {
        sum += Number(num);
      }
      return sum;
    };
  }

  // 2. Promise.try (TC39 Stage 3)
  if (typeof Promise.try !== 'function') {
    Promise.try = function(fn, ...args) {
      return new Promise((resolve) => {
        resolve(fn(...args));
      });
    };
  }

  // 3. URL.parse (Baseline 2024 / Chromium 126+)
  if (typeof URL.parse !== 'function') {
    URL.parse = function(url, base) {
      try {
        return new URL(url, base);
      } catch {
        return null;
      }
    };
  }

  // 4. Promise.withResolvers (ECMAScript 2024)
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function() {
      let resolve, reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }

  // 5. RegExp.escape (TC39 Stage 3)
  if (typeof RegExp.escape !== 'function') {
    RegExp.escape = function(str) {
      return String(str).replace(/[\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
    };
  }

  // 6. Map.prototype.getOrInsertComputed / getOrInsert (TC39 Stage 3)
  if (!Map.prototype.getOrInsertComputed) {
    Map.prototype.getOrInsertComputed = function(key, callback) {
      if (this.has(key)) {
        return this.get(key);
      }
      const value = callback(key);
      this.set(key, value);
      return value;
    };
  }
  if (!Map.prototype.getOrInsert) {
    Map.prototype.getOrInsert = function(key, defaultValue) {
      if (this.has(key)) {
        return this.get(key);
      }
      this.set(key, defaultValue);
      return defaultValue;
    };
  }

  // 7. Set methods (TC39 Set Methods / ECMAScript 2024)
  if (!Set.prototype.intersection) {
    Set.prototype.intersection = function(other) {
      const result = new Set();
      const otherSet = other instanceof Set ? other : new Set(other);
      for (const item of this) {
        if (otherSet.has(item)) {
          result.add(item);
        }
      }
      return result;
    };
  }
  if (!Set.prototype.union) {
    Set.prototype.union = function(other) {
      const result = new Set(this);
      for (const item of other) {
        result.add(item);
      }
      return result;
    };
  }
  if (!Set.prototype.difference) {
    Set.prototype.difference = function(other) {
      const result = new Set(this);
      const otherSet = other instanceof Set ? other : new Set(other);
      for (const item of otherSet) {
        result.delete(item);
      }
      return result;
    };
  }

  // 8. Uint8Array methods (TC39 Uint8Array to/from base64 and hex)
  if (!Uint8Array.prototype.toHex) {
    Uint8Array.prototype.toHex = function() {
      let hex = '';
      for (let i = 0; i < this.length; i++) {
        hex += this[i].toString(16).padStart(2, '0');
      }
      return hex;
    };
  }
  if (!Uint8Array.prototype.toBase64) {
    Uint8Array.prototype.toBase64 = function() {
      let binary = '';
      const bytes = this;
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    };
  }
  if (!Uint8Array.fromHex) {
    Uint8Array.fromHex = function(hexString) {
      const bytes = new Uint8Array(hexString.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hexString.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    };
  }
  if (!Uint8Array.fromBase64) {
    Uint8Array.fromBase64 = function(base64String) {
      const binary = atob(base64String);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    };
  }
`;

const mainWorldInitScript = `
(() => {
  const polyfillCode = ${JSON.stringify(polyfillSource)};

  // 1. Apply polyfills to main window context
  eval(polyfillCode);

  // 2. Wrap Worker constructor so Web Workers inherit polyfills
  const OriginalWorker = window.Worker;
  window.Worker = class extends OriginalWorker {
    constructor(scriptURL, options) {
      try {
        const resolvedUrl = (typeof scriptURL === 'string' || scriptURL instanceof URL)
          ? new URL(scriptURL, window.location.href).href
          : scriptURL.toString();

        if (options && options.type === 'module') {
          const wrapperSource = polyfillCode + '\\nimport ' + JSON.stringify(resolvedUrl) + ';\\n';
          const blob = new Blob([wrapperSource], { type: 'application/javascript' });
          super(URL.createObjectURL(blob), options);
        } else {
          const wrapperSource = polyfillCode + '\\nimportScripts(' + JSON.stringify(resolvedUrl) + ');\\n';
          const blob = new Blob([wrapperSource], { type: 'application/javascript' });
          super(URL.createObjectURL(blob), options);
        }
      } catch (err) {
        super(scriptURL, options);
      }
    }
  };

  // 3. In-memory virtualization-safe overlay store
  const overlayStore = new Map();

  function initAppIntegration() {
    const App = window.PDFViewerApplication;
    if (!App || !App.initializedPromise) return;

    App.initializedPromise.then(() => {
      // Re-inject overlays whenever a virtualized page renders
      App.eventBus.on('pagerendered', (evt) => {
        const pageIndex = evt.pageNumber;
        const pageView = App.pdfViewer.getPageView(pageIndex - 1);
        if (!pageView) return;

        const pageDiv = pageView.div;
        let layer = pageDiv.querySelector('.ext-overlay-layer');

        if (!layer) {
          layer = document.createElement('div');
          layer.className = 'ext-overlay-layer';
          layer.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;';
          pageDiv.appendChild(layer);
        }

        if (overlayStore.has(pageIndex)) {
          layer.innerHTML = '';
          overlayStore.get(pageIndex).items.forEach(item => {
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
  }

  // Listen for webviewerloaded event (dispatched on document and window)
  document.addEventListener('webviewerloaded', initAppIntegration, { once: true });
  window.addEventListener('webviewerloaded', initAppIntegration, { once: true });

  // Expose __PDF_ADAPTER__ on the main world window
  window.__PDF_ADAPTER__ = {
    addAnnotation: (pageIndex, annotation) => {
      if (!overlayStore.has(pageIndex)) {
        overlayStore.set(pageIndex, { pageIndex, items: [] });
      }
      overlayStore.get(pageIndex).items.push(annotation);

      const App = window.PDFViewerApplication;
      if (App && App.pdfViewer) {
        const pageView = App.pdfViewer.getPageView(pageIndex - 1);
        if (pageView && pageView.div) {
          let layer = pageView.div.querySelector('.ext-overlay-layer');
          if (!layer) {
            layer = document.createElement('div');
            layer.className = 'ext-overlay-layer';
            layer.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;';
            pageView.div.appendChild(layer);
          }
          const wrapper = document.createElement('div');
          wrapper.id = annotation.id;
          wrapper.innerHTML = annotation.content;
          layer.appendChild(wrapper);
        }
      }
    },
    getPDFBytes: async () => {
      const App = window.PDFViewerApplication;
      if (!App || !App.pdfDocument) {
        throw new Error('PDF document not loaded');
      }
      return await App.pdfDocument.saveDocument();
    }
  };
})();
`;

// Execute init script in main world context
webFrame.executeJavaScript(mainWorldInitScript);

// Apply polyfills to isolated world context
eval(polyfillSource);
