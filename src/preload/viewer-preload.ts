// src/preload/viewer-preload.ts
import { contextBridge, ipcRenderer, webFrame } from 'electron';

contextBridge.exposeInMainWorld('__PDF_TEXT_EDITOR_IPC__', {
  apply: (originalPdfBytes: Uint8Array, edits: unknown[]) =>
    ipcRenderer.invoke('pdf:apply-text-edits', originalPdfBytes, edits),
});

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

  // 3. CSS round() math function polyfill / sanitizer for Chromium <125
  function sanitizeCssValue(val) {
    if (typeof val !== 'string' || !val.includes('round(')) return val;
    let res = '';
    let idx = 0;
    while (true) {
      const pos = val.indexOf('round(', idx);
      if (pos === -1) {
        res += val.slice(idx);
        break;
      }
      res += val.slice(idx, pos);
      let depth = 1;
      let parts = [''];
      let curPart = 0;
      let endPos = -1;
      for (let i = pos + 6; i < val.length; i++) {
        const ch = val[i];
        if (ch === '(') {
          depth++;
          parts[curPart] += ch;
        } else if (ch === ')') {
          depth--;
          if (depth === 0) {
            endPos = i;
            break;
          } else {
            parts[curPart] += ch;
          }
        } else if (ch === ',' && depth === 1) {
          curPart++;
          parts[curPart] = '';
        } else {
          parts[curPart] += ch;
        }
      }
      if (endPos !== -1 && parts.length >= 2) {
        let expr = parts.length === 3 ? parts[1].trim() : parts[0].trim();
        res += 'calc(' + expr + ')';
        idx = endPos + 1;
      } else {
        res += val.slice(pos, pos + 6);
        idx = pos + 6;
      }
    }
    return res;
  }

  const origSetProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function(property, value, priority) {
    return origSetProperty.call(this, property, sanitizeCssValue(value), priority);
  };

  function wrapStyleGetter(proto) {
    if (!proto) return;
    const origDesc = Object.getOwnPropertyDescriptor(proto, 'style');
    if (!origDesc || !origDesc.get) return;
    const proxyMap = new WeakMap();
    Object.defineProperty(proto, 'style', {
      get: function() {
        const realStyle = origDesc.get.call(this);
        if (!realStyle) return realStyle;
        let proxy = proxyMap.get(realStyle);
        if (!proxy) {
          proxy = new Proxy(realStyle, {
            get(target, prop, receiver) {
              const val = Reflect.get(target, prop, receiver);
              if (typeof val === 'function') {
                if (prop === 'setProperty') {
                  return function(propertyName, value, priority) {
                    return target.setProperty(propertyName, sanitizeCssValue(value), priority);
                  };
                }
                return val.bind(target);
              }
              return val;
            },
            set(target, prop, value, receiver) {
              const sanitized = sanitizeCssValue(value);
              target[prop] = sanitized;
              return true;
            }
          });
          proxyMap.set(realStyle, proxy);
        }
        return proxy;
      },
      set: origDesc.set,
      configurable: true,
      enumerable: origDesc.enumerable
    });
  }

  wrapStyleGetter(HTMLElement.prototype);
  if (typeof SVGElement !== 'undefined') wrapStyleGetter(SVGElement.prototype);
  if (typeof Element !== 'undefined' && Element.prototype !== HTMLElement.prototype) {
    wrapStyleGetter(Element.prototype);
  }

  // 4. In-memory virtualization-safe overlay stores
  const overlayStore = new Map();
  const textEditStore = new Map();
  let textEditMode = false;

  function getTextEditLayer(pageView) {
    let layer = pageView.div.querySelector('.ext-text-edit-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'ext-text-edit-layer';
      layer.style.cssText = 'position:absolute; inset:0; z-index:30; pointer-events:none;';
      pageView.div.appendChild(layer);
    }
    // The layer must not catch page clicks: before a text run has been edited,
    // the actual PDF.js text layer is the only target that identifies it.
    layer.style.pointerEvents = 'none';
    return layer;
  }

  function cssColorToRgb(value) {
    const matches = String(value).match(/\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 3) return { r: 0, g: 0, b: 0 };
    return {
      r: Math.min(255, Number(matches[0])) / 255,
      g: Math.min(255, Number(matches[1])) / 255,
      b: Math.min(255, Number(matches[2])) / 255,
    };
  }

  function getFontStyle(style) {
    const bold = Number(style.fontWeight) >= 600 || /bold/i.test(style.fontWeight);
    const italic = /italic|oblique/i.test(style.fontStyle);
    if (bold && italic) return 'boldItalic';
    if (bold) return 'bold';
    if (italic) return 'italic';
    return 'normal';
  }

  function getDomBounds(edit, viewport) {
    const first = viewport.convertToViewportPoint(edit.x, edit.y);
    const second = viewport.convertToViewportPoint(edit.x + edit.width, edit.y + edit.height);
    return {
      left: Math.min(first[0], second[0]),
      top: Math.min(first[1], second[1]),
      width: Math.abs(second[0] - first[0]),
      height: Math.abs(second[1] - first[1]),
    };
  }

  function renderTextEdits(pageNumber, pageView) {
    const layer = getTextEditLayer(pageView);
    layer.replaceChildren();
    for (const edit of textEditStore.values()) {
      if (edit.pageIndex !== pageNumber) continue;
      const bounds = getDomBounds(edit, pageView.viewport);
      const item = document.createElement('div');
      item.dataset.pdfTextEditId = edit.id;
      item.textContent = edit.text;
      item.title = textEditMode ? 'Edit text' : '';
      item.style.cssText = [
        'position:absolute',
        'box-sizing:border-box',
        'overflow:visible',
        'white-space:pre',
        'background:#fff',
        'border:0',
        'padding:0',
        'margin:0',
        'line-height:1',
        'cursor:' + (textEditMode ? 'text' : 'default'),
        'pointer-events:' + (textEditMode ? 'auto' : 'none'),
        'left:' + bounds.left + 'px',
        'top:' + bounds.top + 'px',
        'width:' + Math.max(1, bounds.width) + 'px',
        'min-height:' + Math.max(1, bounds.height) + 'px',
        'font-family:' + edit.fontFamily,
        'font-size:' + (edit.fontSize * pageView.viewport.scale) + 'px',
        'font-weight:' + edit.fontWeight,
        'font-style:' + edit.fontCssStyle,
        'color:rgb(' + Math.round(edit.color.r * 255) + ',' + Math.round(edit.color.g * 255) + ',' + Math.round(edit.color.b * 255) + ')',
      ].join(';');
      layer.appendChild(item);
    }
  }

  function renderAllTextEdits(App) {
    for (let index = 0; index < App.pdfViewer.pagesCount; index++) {
      const pageView = App.pdfViewer.getPageView(index);
      if (pageView && pageView.div) renderTextEdits(index + 1, pageView);
    }
  }

  function findPageView(App, element) {
    const page = element.closest('.page');
    if (!page) return null;
    for (let index = 0; index < App.pdfViewer.pagesCount; index++) {
      const pageView = App.pdfViewer.getPageView(index);
      if (pageView && pageView.div === page) return { pageView, pageNumber: index + 1 };
    }
    return null;
  }

  function editForTextLayerSpan(span, pageNumber, pageView) {
    const pageBounds = pageView.div.getBoundingClientRect();
    const bounds = span.getBoundingClientRect();
    const left = bounds.left - pageBounds.left;
    const top = bounds.top - pageBounds.top;
    const right = left + bounds.width;
    const bottom = top + bounds.height;
    const first = pageView.viewport.convertToPdfPoint(left, top);
    const second = pageView.viewport.convertToPdfPoint(right, bottom);
    const style = getComputedStyle(span);
    const height = Math.abs(second[1] - first[1]);
    const cssFontSize = Number.parseFloat(style.fontSize);
    return {
      id: 'text-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      pageIndex: pageNumber,
      text: span.textContent || '',
      x: Math.min(first[0], second[0]),
      y: Math.min(first[1], second[1]),
      width: Math.abs(second[0] - first[0]),
      height,
      fontSize: Number.isFinite(cssFontSize) ? cssFontSize / pageView.viewport.scale : height * 0.8,
      fontStyle: getFontStyle(style),
      fontFamily: style.fontFamily || 'sans-serif',
      fontWeight: style.fontWeight || 'normal',
      fontCssStyle: style.fontStyle || 'normal',
      color: cssColorToRgb(style.color),
    };
  }

  function openTextEditor(App, edit, isNew) {
    const pageView = App.pdfViewer.getPageView(edit.pageIndex - 1);
    if (!pageView) return;
    const layer = getTextEditLayer(pageView);
    renderTextEdits(edit.pageIndex, pageView);
    const display = layer.querySelector('[data-pdf-text-edit-id="' + edit.id + '"]');
    if (display) display.remove();

    const bounds = getDomBounds(edit, pageView.viewport);
    const input = document.createElement('textarea');
    input.value = edit.text;
    input.setAttribute('aria-label', 'Edit PDF text');
    input.dataset.pdfTextEditor = edit.id;
    input.style.cssText = [
      'position:absolute',
      'box-sizing:border-box',
      'resize:both',
      'z-index:1',
      'left:' + bounds.left + 'px',
      'top:' + bounds.top + 'px',
      'width:' + Math.max(24, bounds.width + 8) + 'px',
      'min-height:' + Math.max(22, bounds.height + 6) + 'px',
      'padding:1px 3px',
      'border:1px solid #0b57d0',
      'outline:0',
      'background:#fff',
      'line-height:1.1',
      'font-family:' + edit.fontFamily,
      'font-size:' + (edit.fontSize * pageView.viewport.scale) + 'px',
      'font-weight:' + edit.fontWeight,
      'font-style:' + edit.fontCssStyle,
      'color:rgb(' + Math.round(edit.color.r * 255) + ',' + Math.round(edit.color.g * 255) + ',' + Math.round(edit.color.b * 255) + ')',
    ].join(';');

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (commit && input.value) {
        edit.text = input.value;
        textEditStore.set(edit.id, edit);
      } else if (isNew) {
        textEditStore.delete(edit.id);
      }
      renderTextEdits(edit.pageIndex, pageView);
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finish(true);
      }
    });
    layer.appendChild(input);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  async function exportTextEdits(App) {
    if (textEditStore.size === 0) return;
    const source = await App.pdfDocument.getData();
    const edited = await window.__PDF_TEXT_EDITOR_IPC__.apply(source, Array.from(textEditStore.values()));
    const blob = new Blob([edited], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'edited.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function installTextEditor(App) {
    if (document.getElementById('ext-text-edit-mode')) return;
    const separator = document.getElementById('editorModeSeparator');
    if (!separator || !separator.parentElement) return;

    const style = document.createElement('style');
    style.id = 'ext-text-editor-styles';
    style.textContent = [
      '#ext-text-edit-mode::before { -webkit-mask-image:url(images/editor-toolbar-edit.svg); mask-image:url(images/editor-toolbar-edit.svg); }',
      '#ext-text-edit-export::before { -webkit-mask-image:url(images/toolbarButton-download.svg); mask-image:url(images/toolbarButton-download.svg); }',
      '#viewerContainer.ext-text-editing .textLayer span { cursor:text !important; }',
      '.ext-text-edit-layer textarea { pointer-events:auto; }',
    ].join('\\n');
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.id = 'ext-text-edit-buttons';
    container.className = 'toolbarHorizontalGroup';

    const createButton = (id, label) => {
      const button = document.createElement('button');
      button.id = id;
      button.type = 'button';
      button.className = 'toolbarButton';
      button.title = label;
      button.setAttribute('aria-label', label);
      const accessibleLabel = document.createElement('span');
      accessibleLabel.textContent = label;
      button.appendChild(accessibleLabel);
      return button;
    };

    const modeButton = createButton('ext-text-edit-mode', 'Edit existing PDF text');
    modeButton.addEventListener('click', () => {
      textEditMode = !textEditMode;
      modeButton.classList.toggle('toggled', textEditMode);
      modeButton.setAttribute('aria-pressed', String(textEditMode));
      document.getElementById('viewerContainer')?.classList.toggle('ext-text-editing', textEditMode);
      renderAllTextEdits(App);
    });
    container.appendChild(modeButton);

    const exportButton = createButton('ext-text-edit-export', 'Export PDF with text edits');
    exportButton.addEventListener('click', async () => {
      try {
        await exportTextEdits(App);
      } catch (error) {
        console.error('Unable to export text edits', error);
      }
    });
    container.appendChild(exportButton);
    separator.parentElement.insertBefore(container, separator);

    document.addEventListener('click', (event) => {
      if (!textEditMode) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('textarea')) return;
      const existing = target.closest('[data-pdf-text-edit-id]');
      if (existing) {
        event.preventDefault();
        event.stopPropagation();
        const edit = textEditStore.get(existing.dataset.pdfTextEditId);
        if (edit) openTextEditor(App, edit, false);
        return;
      }
      const span = target.closest('.textLayer span');
      if (!span) return;
      const located = findPageView(App, span);
      if (!located) return;
      event.preventDefault();
      event.stopPropagation();
      const edit = editForTextLayerSpan(span, located.pageNumber, located.pageView);
      if (!edit.text.trim()) return;
      textEditStore.set(edit.id, edit);
      openTextEditor(App, edit, true);
    }, true);
  }

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

        renderTextEdits(pageIndex, pageView);

        window.postMessage({
          type: 'PDF_PAGE_RENDERED',
          payload: {
            pageNumber: pageIndex,
            scale: App.pdfViewer.currentScale,
            viewport: pageView.viewport
          }
        }, '*');
      });
      installTextEditor(App);
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
