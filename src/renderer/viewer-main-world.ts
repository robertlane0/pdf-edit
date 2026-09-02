// src/renderer/viewer-main-world.ts
// Main-world script for PDF.js viewer integration.
// This file is compiled to dist/renderer/viewer-main-world.js and injected
// into the main world via a <script> tag (see src/preload/viewer-preload.ts),
// avoiding eval() / webFrame.executeJavaScript(string) patterns (SEC-6).
// It is intentionally a plain script (no imports/exports) so the compiled
// output is directly executable in the browser without a bundler.

// The IIFE below encapsulates all main-world state to avoid leaking globals.
(() => {
  // ---- Polyfills (duplicated from src/renderer/polyfills/polyfills.ts for self-containment) ----
  // Feature-detected, documented per SEC-6.
  // Keeping this self-contained ensures the compiled viewer-main-world.js is runnable as a plain <script>.

  // Math.sumPrecise (TC39 Stage 3, Chromium 119+). Needed for PDF.js v5+.
  if (typeof (Math as unknown as Record<string, unknown>).sumPrecise !== 'function') {
    (Math as unknown as Record<string, unknown>).sumPrecise = function (iterable: Iterable<unknown>) {
      let sum = 0;
      for (const num of iterable) sum += Number(num);
      return sum;
    };
  }
  // Promise.try (TC39 Stage 3)
  if (typeof (Promise as unknown as Record<string, unknown>).try !== 'function') {
    (Promise as unknown as Record<string, unknown>).try = function (
      fn: (...args: unknown[]) => unknown,
      ...args: unknown[]
    ) {
      return new Promise((resolve) => resolve((fn as (...a: unknown[]) => unknown)(...args)));
    };
  }
  // URL.parse (Chromium 126+)
  if (typeof (URL as unknown as Record<string, unknown>).parse !== 'function') {
    (URL as unknown as Record<string, unknown>).parse = function (url: string, base?: string) {
      try {
        return new URL(url, base);
      } catch {
        return null;
      }
    };
  }
  // Promise.withResolvers (ECMAScript 2024)
  if (typeof (Promise as unknown as Record<string, unknown>).withResolvers !== 'function') {
    (Promise as unknown as Record<string, unknown>).withResolvers = function () {
      let resolve!: (v: unknown) => void;
      let reject!: (r?: unknown) => void;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }
  // RegExp.escape (TC39 Stage 3)
  if (typeof (RegExp as unknown as Record<string, unknown>).escape !== 'function') {
    (RegExp as unknown as Record<string, unknown>).escape = function (str: string) {
      return String(str).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
    };
  }
  // Map.getOrInsertComputed / getOrInsert
  const mapProto = Map.prototype as unknown as Record<string, unknown>;
  if (typeof mapProto.getOrInsertComputed !== 'function') {
    mapProto.getOrInsertComputed = function (
      this: Map<unknown, unknown>,
      key: unknown,
      cb: (k: unknown) => unknown
    ) {
      if (this.has(key)) return this.get(key);
      const v = cb(key);
      this.set(key, v);
      return v;
    };
  }
  if (typeof mapProto.getOrInsert !== 'function') {
    mapProto.getOrInsert = function (this: Map<unknown, unknown>, key: unknown, def: unknown) {
      if (this.has(key)) return this.get(key);
      this.set(key, def);
      return def;
    };
  }
  // Set methods
  const setProto = Set.prototype as unknown as Record<string, unknown>;
  if (typeof setProto.intersection !== 'function') {
    setProto.intersection = function (this: Set<unknown>, other: Set<unknown> | Iterable<unknown>) {
      const res = new Set<unknown>();
      const otherSet = other instanceof Set ? other : new Set(other);
      for (const item of this) if (otherSet.has(item)) res.add(item);
      return res;
    };
  }
  if (typeof setProto.union !== 'function') {
    setProto.union = function (this: Set<unknown>, other: Iterable<unknown>) {
      const res = new Set(this);
      for (const item of other) res.add(item);
      return res;
    };
  }
  if (typeof setProto.difference !== 'function') {
    setProto.difference = function (this: Set<unknown>, other: Set<unknown> | Iterable<unknown>) {
      const res = new Set(this);
      const otherSet = other instanceof Set ? other : new Set(other);
      for (const item of otherSet) res.delete(item);
      return res;
    };
  }
  // Uint8Array
  const uint8Proto = Uint8Array.prototype as unknown as Record<string, unknown>;
  if (typeof uint8Proto.toHex !== 'function') {
    uint8Proto.toHex = function (this: Uint8Array) {
      let hex = '';
      for (let i = 0; i < this.length; i++) hex += this[i].toString(16).padStart(2, '0');
      return hex;
    };
  }
  if (typeof uint8Proto.toBase64 !== 'function') {
    uint8Proto.toBase64 = function (this: Uint8Array) {
      let binary = '';
      const b: Uint8Array = this;
      for (let i = 0; i < b.byteLength; i++) binary += String.fromCharCode(b[i]);
      return btoa(binary);
    };
  }
  const uint8Ctor = Uint8Array as unknown as Record<string, unknown>;
  if (typeof uint8Ctor.fromHex !== 'function') {
    uint8Ctor.fromHex = function (hexString: string) {
      const bytes = new Uint8Array(hexString.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hexString.slice(i * 2, i * 2 + 2), 16);
      return bytes;
    };
  }
  if (typeof uint8Ctor.fromBase64 !== 'function') {
    uint8Ctor.fromBase64 = function (base64String: string) {
      const binary = atob(base64String);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    };
  }

  // ---- CSS round() polyfill with feature detection (scoped, not unconditional) ----
  function supportsCssRound(): boolean {
    try {
      if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
        return CSS.supports('width', 'round(1px, 1px)');
      }
    } catch {
      // ignore
    }
    return false;
  }

  function sanitizeCssValue(val: string): string {
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
      let parts: string[] = [''];
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
        const expr = parts.length === 3 ? parts[1].trim() : parts[0].trim();
        res += 'calc(' + expr + ')';
        idx = endPos + 1;
      } else {
        res += val.slice(pos, pos + 6);
        idx = pos + 6;
      }
    }
    return res;
  }

  // Only install the CSS round() workaround if native support is missing.
  // On Electron 31+ (Chromium 125+) this is natively supported and the patch is skipped entirely,
  // addressing PERF-2 and SEC-6's "unscoped global Proxy" concern.
  const needsCssRoundPolyfill = !supportsCssRound();

  if (needsCssRoundPolyfill) {
    const origSetProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (
      this: CSSStyleDeclaration,
      property: string,
      value: string,
      priority?: string
    ) {
      return origSetProperty.call(this, property, sanitizeCssValue(value), priority);
    };

    function wrapStyleGetter(proto: unknown) {
      if (!proto) return;
      const origDesc = Object.getOwnPropertyDescriptor(proto as object, 'style');
      if (!origDesc || !origDesc.get) return;
      const proxyMap = new WeakMap<object, unknown>();
      Object.defineProperty(proto as object, 'style', {
        get: function (this: Element) {
          const realStyle = (origDesc.get as () => CSSStyleDeclaration).call(this);
          if (!realStyle) return realStyle;
          let proxy = proxyMap.get(realStyle as object);
          if (!proxy) {
            proxy = new Proxy(realStyle, {
              get(target: CSSStyleDeclaration, prop: string | symbol, receiver: unknown) {
                const val = Reflect.get(target as object, prop, receiver);
                if (typeof val === 'function') {
                  if (prop === 'setProperty') {
                    return function (propertyName: string, value: string, priority?: string) {
                      return (target as CSSStyleDeclaration).setProperty(
                        propertyName,
                        sanitizeCssValue(value),
                        priority
                      );
                    };
                  }
                  return (val as (...args: unknown[]) => unknown).bind(target);
                }
                return val;
              },
              set(target: CSSStyleDeclaration, prop: string | symbol, value: unknown, _receiver: unknown) {
                const sanitized = sanitizeCssValue(value as string);
                (target as unknown as Record<string | symbol, unknown>)[prop] = sanitized;
                return true;
              },
            });
            proxyMap.set(realStyle as object, proxy);
          }
          return proxy;
        },
        set: origDesc.set,
        configurable: true,
        enumerable: origDesc.enumerable,
      });
    }

    wrapStyleGetter(HTMLElement.prototype);
    const globalScope = globalThis as unknown as { SVGElement?: unknown; Element?: unknown };
    if (typeof globalScope.SVGElement !== 'undefined')
      wrapStyleGetter((globalScope.SVGElement as { prototype: unknown }).prototype);
    if (
      typeof globalScope.Element !== 'undefined' &&
      (globalScope.Element as { prototype: unknown }).prototype !== HTMLElement.prototype
    ) {
      wrapStyleGetter((globalScope.Element as { prototype: unknown }).prototype);
    }
  }

  // Wrap Worker constructor so Web Workers inherit polyfills.
  // This patch is scoped to the window's Worker and is the minimal shim
  // needed to propagate polyfills into dedicated workers for PDF.js.
  const OriginalWorker = window.Worker;
  // Type assertion to allow subclassing
  const WorkerCtor = OriginalWorker as unknown as new (
    scriptURL: string | URL,
    options?: WorkerOptions
  ) => Worker;
  if (WorkerCtor) {
    // Re-create polyfill source for worker injection without eval in main thread;
    // the worker blob is constructed from the same self-contained polyfill logic
    // but executed as a worker script, not via eval in the main thread.
    const workerPolyfillPrefix = (() => {
      // Extract the polyfill definitions above as a string for worker blobs
      // This is generated at runtime from functions already defined above,
      // but without using eval in the main thread's execution path.
      // Instead we inline a minimal static prefix for workers.
      return `
  if (typeof Math.sumPrecise !== 'function') { Math.sumPrecise = function(iterable){ let sum=0; for(const num of iterable) sum+=Number(num); return sum; }; }
  if (typeof Promise.try !== 'function') { Promise.try = function(fn,...args){ return new Promise((resolve)=>{ resolve(fn(...args)); }); }; }
  if (typeof URL.parse !== 'function') { URL.parse = function(url, base){ try{ return new URL(url, base);} catch{ return null; }}; }
  if (typeof Promise.withResolvers !== 'function') { Promise.withResolvers = function(){ let resolve,reject; const promise=new Promise((res,rej)=>{resolve=res;reject=rej;}); return{promise,resolve,reject}; }; }
  if (typeof RegExp.escape !== 'function') { RegExp.escape = function(str){ return String(str).replace(/[\\\\^$*+?.()|[\\]{}]/g,'\\\\$&'); }; }
`;
    })();

    (window as unknown as Record<string, unknown>).Worker = class extends WorkerCtor {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        try {
          const resolvedUrl =
            typeof scriptURL === 'string' || scriptURL instanceof URL
              ? new URL(scriptURL as string, window.location.href).href
              : (scriptURL as string).toString();

          if (options && options.type === 'module') {
            const wrapperSource = workerPolyfillPrefix + '\nimport ' + JSON.stringify(resolvedUrl) + ';\n';
            const blob = new Blob([wrapperSource], { type: 'application/javascript' });
            super(URL.createObjectURL(blob), options);
          } else {
            const wrapperSource =
              workerPolyfillPrefix + '\nimportScripts(' + JSON.stringify(resolvedUrl) + ');\n';
            const blob = new Blob([wrapperSource], { type: 'application/javascript' });
            super(URL.createObjectURL(blob), options);
          }
        } catch (_err) {
          super(scriptURL as string, options);
        }
      }
    } as unknown as typeof Worker;
  }

  // ---- In-memory virtualization-safe stores (same semantics as before, now typed and lintable) ----
  type OverlayItem = { id: string; content: string };
  type PageOverlayState = { pageIndex: number; items: OverlayItem[] };
  const overlayStore = new Map<number, PageOverlayState>();

  type TextEdit = {
    id: string;
    pageIndex: number;
    sourceText: string;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontStyle: string;
    fontFamily: string;
    fontWeight: string;
    fontCssStyle: string;
    color: { r: number; g: number; b: number };
  };
  const textEditStore = new Map<string, TextEdit>();
  let textEditMode = false;

  function getTextEditLayer(pageView: { div: HTMLElement }): HTMLElement {
    let layer = pageView.div.querySelector('.ext-text-edit-layer') as HTMLElement | null;
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'ext-text-edit-layer';
      layer.style.cssText = 'position:absolute; inset:0; z-index:30; pointer-events:none;';
      pageView.div.appendChild(layer);
    }
    layer.style.pointerEvents = 'none';
    return layer;
  }

  function cssColorToRgb(value: string): { r: number; g: number; b: number } {
    const matches = String(value).match(/\d+(?:\.\d+)?/g);
    if (!matches || matches.length < 3) return { r: 0, g: 0, b: 0 };
    return {
      r: Math.min(255, Number(matches[0])) / 255,
      g: Math.min(255, Number(matches[1])) / 255,
      b: Math.min(255, Number(matches[2])) / 255,
    };
  }

  function getFontStyle(style: CSSStyleDeclaration): string {
    const bold = Number(style.fontWeight) >= 600 || /bold/i.test(style.fontWeight);
    const italic = /italic|oblique/i.test(style.fontStyle);
    if (bold && italic) return 'boldItalic';
    if (bold) return 'bold';
    if (italic) return 'italic';
    return 'normal';
  }

  function getDomBounds(
    edit: TextEdit,
    viewport: { convertToViewportPoint: (x: number, y: number) => [number, number] }
  ): { left: number; top: number; width: number; height: number } {
    const first = viewport.convertToViewportPoint(edit.x, edit.y);
    const second = viewport.convertToViewportPoint(edit.x + edit.width, edit.y + edit.height);
    return {
      left: Math.min(first[0], second[0]),
      top: Math.min(first[1], second[1]),
      width: Math.abs(second[0] - first[0]),
      height: Math.abs(second[1] - first[1]),
    };
  }

  function renderTextEdits(
    pageNumber: number,
    pageView: { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } }
  ): void {
    const layer = getTextEditLayer(pageView as { div: HTMLElement });
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
        'font-size:' + edit.fontSize * pageView.viewport.scale + 'px',
        'font-weight:' + edit.fontWeight,
        'font-style:' + edit.fontCssStyle,
        'color:rgb(' +
          Math.round(edit.color.r * 255) +
          ',' +
          Math.round(edit.color.g * 255) +
          ',' +
          Math.round(edit.color.b * 255) +
          ')',
      ].join(';');
      layer.appendChild(item);
    }
  }

  function renderAllTextEdits(App: {
    pdfViewer: { pagesCount: number; getPageView: (i: number) => { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } } | null };
  }): void {
    for (let index = 0; index < App.pdfViewer.pagesCount; index++) {
      const pageView = App.pdfViewer.getPageView(index);
      if (pageView && pageView.div) renderTextEdits(index + 1, pageView as unknown as { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } });
    }
  }

  function findPageView(
    App: { pdfViewer: { pagesCount: number; getPageView: (i: number) => { div: HTMLElement } | null } },
    element: Element
  ): { pageView: { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number]; convertToPdfPoint: (x: number, y: number) => [number, number] } }; pageNumber: number } | null {
    const page = element.closest('.page');
    if (!page) return null;
    for (let index = 0; index < App.pdfViewer.pagesCount; index++) {
      const pageView = App.pdfViewer.getPageView(index) as unknown as {
        div: HTMLElement;
        viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number]; convertToPdfPoint: (x: number, y: number) => [number, number] };
      } | null;
      if (pageView && pageView.div === page) return { pageView, pageNumber: index + 1 };
    }
    return null;
  }

  function editForTextLayerSpan(
    span: HTMLElement,
    pageNumber: number,
    pageView: { div: HTMLElement; viewport: { scale: number; convertToPdfPoint: (x: number, y: number) => [number, number] } }
  ): TextEdit {
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
      sourceText: span.textContent || '',
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

  function openTextEditor(
    App: { pdfViewer: { getPageView: (i: number) => { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } } | null } },
    edit: TextEdit,
    isNew: boolean
  ): void {
    const pageView = App.pdfViewer.getPageView(edit.pageIndex - 1) as unknown as {
      div: HTMLElement;
      viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] };
    } | null;
    if (!pageView) return;
    const layer = getTextEditLayer(pageView as { div: HTMLElement });
    renderTextEdits(edit.pageIndex, pageView as unknown as { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } });
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
      'font-size:' + edit.fontSize * pageView.viewport.scale + 'px',
      'font-weight:' + edit.fontWeight,
      'font-style:' + edit.fontCssStyle,
      'color:rgb(' +
        Math.round(edit.color.r * 255) +
        ',' +
        Math.round(edit.color.g * 255) +
        ',' +
        Math.round(edit.color.b * 255) +
        ')',
    ].join(';');

    let finished = false;
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (commit) {
        edit.text = input.value;
        textEditStore.set(edit.id, edit);
      } else if (isNew) {
        textEditStore.delete(edit.id);
      }
      renderTextEdits(
        edit.pageIndex,
        pageView as unknown as { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } }
      );
    };
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (event: KeyboardEvent) => {
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

  async function exportTextEdits(
    App: {
      pdfDocument: { getData: () => Promise<Uint8Array> };
    },
    useFallbackFont?: boolean,
  ): Promise<void> {
    if (textEditStore.size === 0) return;
    const source = await App.pdfDocument.getData();
    const edited = await (
      window as unknown as Record<string, { apply: (b: Uint8Array, e: unknown[], useFallback?: boolean) => Promise<Uint8Array> }>
    ).__PDF_TEXT_EDITOR_IPC__.apply(source, Array.from(textEditStore.values()), !!useFallbackFont);
    const blob = new Blob([edited as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'edited.pdf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function installTextEditor(App: {
    eventBus: { on: (e: string, cb: (evt: { pageNumber: number }) => void) => void };
    pdfViewer: {
      pagesCount: number;
      currentScale: number;
      getPageView: (i: number) => { div: HTMLElement; viewport: unknown } | null;
    };
    pdfDocument: { getData: () => Promise<Uint8Array> };
  }): void {
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
      '#ext-export-error-toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#d93025; color:#fff; padding:10px 16px; border-radius:4px; font-size:13px; z-index:9999; max-width:80%; box-shadow:0 2px 8px rgba(0,0,0,0.3); }',
    ].join('\n');
    document.head.appendChild(style);

    function showExportError(message: string): void {
      let toast = document.getElementById('ext-export-error-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ext-export-error-toast';
        toast.setAttribute('role', 'alert');
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.style.display = 'block';
      clearTimeout((toast as unknown as Record<string, number>)._hideTimer);
      (toast as unknown as Record<string, number>)._hideTimer = window.setTimeout(() => {
        toast!.style.display = 'none';
      }, 4000) as unknown as number;
    }

    const container = document.createElement('div');
    container.id = 'ext-text-edit-buttons';
    container.className = 'toolbarHorizontalGroup';

    const createButton = (id: string, label: string): HTMLButtonElement => {
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
      renderAllTextEdits(
        App as unknown as {
          pdfViewer: { pagesCount: number; getPageView: (i: number) => { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } } | null };
        }
      );
    });
    container.appendChild(modeButton);

    const exportButton = createButton('ext-text-edit-export', 'Export PDF with text edits');
    // Fallback Font Rendering checkbox (unchecked by default)
    // When unchecked, edits requiring missing glyphs throw (current behavior).
    // When checked, those edits are rendered via LiberationSans fallback (white cover + drawText).
    const fallbackWrapper = document.createElement('label');
    fallbackWrapper.id = 'ext-fallback-font-wrapper';
    fallbackWrapper.title = 'When checked, text edits that need glyphs missing from the original font will be rendered with Liberation Sans (subset) instead of throwing. Handles spaces and subset fonts like NimbusRomNo9L.';
    fallbackWrapper.style.cssText = 'display:inline-flex; align-items:center; gap:4px; margin-left:8px; font-size:12px; color:var(--toolbar-color, #333); cursor:pointer; user-select:none;';
    const fallbackCheckbox = document.createElement('input');
    fallbackCheckbox.type = 'checkbox';
    fallbackCheckbox.id = 'ext-fallback-font-toggle';
    fallbackCheckbox.checked = false;
    fallbackCheckbox.style.cssText = 'margin:0;';
    const fallbackLabel = document.createElement('span');
    fallbackLabel.textContent = 'Fallback Font Rendering';
    fallbackLabel.style.cssText = 'white-space:nowrap;';
    fallbackWrapper.appendChild(fallbackCheckbox);
    fallbackWrapper.appendChild(fallbackLabel);

    exportButton.addEventListener('click', async () => {
      const useFallback = (document.getElementById('ext-fallback-font-toggle') as HTMLInputElement | null)?.checked ?? false;
      try {
        await exportTextEdits(
          App as unknown as { pdfDocument: { getData: () => Promise<Uint8Array> } },
          useFallback,
        );
      } catch (error) {
        console.error('Unable to export text edits', error);
        const message =
          error instanceof Error && error.message.includes('Unable to locate')
            ? `Couldn't export: ${error.message} The PDF's font may use a custom encoding. Try editing a smaller portion of the text.`
            : `Couldn't export: ${error instanceof Error ? error.message : String(error)}`;
        showExportError(message);
      }
    });
    container.appendChild(exportButton);
    container.appendChild(fallbackWrapper);
    separator.parentElement.insertBefore(container, separator);

    document.addEventListener(
      'click',
      (event: MouseEvent) => {
        if (!textEditMode) return;
        const target = event.target;
        if (!(target instanceof Element) || (target as Element).closest('textarea')) return;
        const existing = (target as Element).closest('[data-pdf-text-edit-id]');
        if (existing) {
          event.preventDefault();
          event.stopPropagation();
          const id = (existing as HTMLElement).dataset.pdfTextEditId;
          if (!id) return;
          const edit = textEditStore.get(id);
          if (edit)
            openTextEditor(
              App as unknown as {
                pdfViewer: { getPageView: (i: number) => { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } } | null };
              },
              edit,
              false
            );
          return;
        }
        const span = (target as Element).closest('.textLayer span') as HTMLElement | null;
        if (!span) return;
        const located = findPageView(
          App as unknown as { pdfViewer: { pagesCount: number; getPageView: (i: number) => { div: HTMLElement } | null } },
          span
        );
        if (!located) return;
        event.preventDefault();
        event.stopPropagation();
        const edit = editForTextLayerSpan(
          span,
          located.pageNumber,
          located.pageView as unknown as { div: HTMLElement; viewport: { scale: number; convertToPdfPoint: (x: number, y: number) => [number, number] } }
        );
        if (!edit.text.trim()) return;
        textEditStore.set(edit.id, edit);
        openTextEditor(
          App as unknown as {
            pdfViewer: { getPageView: (i: number) => { div: HTMLElement; viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] } } | null };
          },
          edit,
          true
        );
      },
      true
    );
  }

  function initAppIntegration(): void {
    const App = (window as unknown as Record<string, unknown>).PDFViewerApplication as unknown as {
      initializedPromise: Promise<void>;
      eventBus: { on: (e: string, cb: (evt: { pageNumber: number }) => void) => void };
      pdfViewer: {
        pagesCount: number;
        currentScale: number;
        getPageView: (i: number) => { div: HTMLElement; viewport: unknown } | null;
      };
      pdfDocument: { saveDocument?: () => Promise<Uint8Array>; getData: () => Promise<Uint8Array> };
    };
    if (!App || !App.initializedPromise) return;

    App.initializedPromise.then(() => {
      App.eventBus.on('pagerendered', (evt: { pageNumber: number }) => {
        const pageIndex = evt.pageNumber;
        const pageView = App.pdfViewer.getPageView(pageIndex - 1) as unknown as {
          div: HTMLElement;
          viewport: unknown;
        } | null;
        if (!pageView) return;

        const pageDiv = pageView.div;
        let layer = pageDiv.querySelector('.ext-overlay-layer') as HTMLElement | null;

        if (!layer) {
          layer = document.createElement('div');
          layer.className = 'ext-overlay-layer';
          layer.style.cssText =
            'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;';
          pageDiv.appendChild(layer);
        }

        if (overlayStore.has(pageIndex)) {
          layer.innerHTML = '';
          overlayStore.get(pageIndex)!.items.forEach((item) => {
            const wrapper = document.createElement('div');
            wrapper.id = item.id;
            wrapper.innerHTML = item.content;
            layer.appendChild(wrapper);
          });
        }

        renderTextEdits(
          pageIndex,
          pageView as unknown as {
            div: HTMLElement;
            viewport: { scale: number; convertToViewportPoint: (x: number, y: number) => [number, number] };
          }
        );

        window.postMessage(
          {
            type: 'PDF_PAGE_RENDERED',
            payload: {
              pageNumber: pageIndex,
              scale: App.pdfViewer.currentScale,
              viewport: pageView.viewport,
            },
          },
          window.location.origin
        );
      });
      installTextEditor(
        App as unknown as {
          eventBus: { on: (e: string, cb: (evt: { pageNumber: number }) => void) => void };
          pdfViewer: {
            pagesCount: number;
            currentScale: number;
            getPageView: (i: number) => { div: HTMLElement; viewport: unknown } | null;
          };
          pdfDocument: { getData: () => Promise<Uint8Array> };
        }
      );
    });
  }

  // Handle both early (before webviewerloaded) and late (after webviewerloaded) injection.
  // The script is now injected via protocol's HTML rewrite (no eval), so it loads before viewer.mjs
  // in the normal case. The fallback below restores text-editing if injection is late
  // (e.g., due to caching or async load) without requiring webFrame.executeJavaScript.
  let integrationInstalled = false;
  const tryInit = () => {
    if (integrationInstalled) return;
    const maybeApp = (window as unknown as Record<string, unknown>).PDFViewerApplication as unknown as {
      initializedPromise?: Promise<void>;
    } | undefined;
    // If the app is already available, run integration immediately; otherwise wait for the event.
    if (maybeApp && maybeApp.initializedPromise) {
      integrationInstalled = true;
      initAppIntegration();
      return;
    }
    // If webviewerloaded has not yet fired, the event listeners below will catch it.
  };

  document.addEventListener('webviewerloaded', () => { integrationInstalled = true; initAppIntegration(); }, { once: true });
  window.addEventListener('webviewerloaded', () => { integrationInstalled = true; initAppIntegration(); }, { once: true });

  // Immediate check for late injection (script loaded after webviewerloaded)
  tryInit();
  // Also poll briefly in case PDFViewerApplication appears asynchronously after this script
  if (!integrationInstalled) {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const maybeApp = (window as unknown as Record<string, unknown>).PDFViewerApplication as unknown as {
        initializedPromise?: Promise<void>;
      } | undefined;
      if (maybeApp && maybeApp.initializedPromise) {
        clearInterval(interval);
        tryInit();
      } else if (attempts > 50) {
        clearInterval(interval);
      }
    }, 100);
    // Safety net for document already loaded
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(tryInit, 500);
    }
  }

  // Expose __PDF_ADAPTER__ on the main world window (for chrome-pdf-editor polyfill)
  (
    window as unknown as Record<string, unknown>
  ).__PDF_ADAPTER__ = {
    addAnnotation: (pageIndex: number, annotation: OverlayItem) => {
      if (!overlayStore.has(pageIndex)) {
        overlayStore.set(pageIndex, { pageIndex, items: [] });
      }
      overlayStore.get(pageIndex)!.items.push(annotation);

      const App = (window as unknown as Record<string, unknown>).PDFViewerApplication as unknown as {
        pdfViewer?: { getPageView: (i: number) => { div: HTMLElement } | null };
      };
      if (App && App.pdfViewer) {
        const pageView = App.pdfViewer.getPageView(pageIndex - 1) as unknown as {
          div: HTMLElement;
        } | null;
        if (pageView && pageView.div) {
          let layer = pageView.div.querySelector('.ext-overlay-layer') as HTMLElement | null;
          if (!layer) {
            layer = document.createElement('div');
            layer.className = 'ext-overlay-layer';
            layer.style.cssText =
              'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;';
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
      const App = (window as unknown as Record<string, unknown>).PDFViewerApplication as unknown as {
        pdfDocument?: { saveDocument: () => Promise<Uint8Array> };
      };
      if (!App || !App.pdfDocument) {
        throw new Error('PDF document not loaded');
      }
      return await App.pdfDocument.saveDocument();
    },
  };
})();
