// src/preload/viewer-preload.ts
// Preload bridge between Electron main and the PDF.js viewer (main world).
// SEC-6 fix: no eval(), no webFrame.executeJavaScript(string) with inline template.
// Polyfills are imported as a typed module and applied directly; main-world logic
// is compiled separately to dist/renderer/viewer-main-world.js and injected via
// the custom protocol's viewer.html rewrite (see src/main/protocol.ts –
// injectViewerMainWorldScript). This makes the code lintable, type-checked,
// and CSP-compatible while preserving text-editing functionality.

import { contextBridge, ipcRenderer } from 'electron';

// Expose IPC bridge for text editing (used by the main-world script via window.__PDF_TEXT_EDITOR_IPC__)
contextBridge.exposeInMainWorld('__PDF_TEXT_EDITOR_IPC__', {
  apply: (originalPdfBytes: Uint8Array, edits: unknown[]) =>
    ipcRenderer.invoke('pdf:apply-text-edits', originalPdfBytes, edits),
});

// Isolated-world polyfills (inlined to avoid require() in sandboxed preload).
// Duplicated from src/renderer/polyfills/polyfills.ts for self-containment but
// keeps the preload free of external requires which fail with sandbox:true.
function applyPolyfills(): void {
  if (typeof (Math as unknown as Record<string, unknown>).sumPrecise !== 'function') {
    (Math as unknown as Record<string, unknown>).sumPrecise = function (iterable: Iterable<unknown>) {
      let sum = 0;
      for (const num of iterable) sum += Number(num);
      return sum;
    };
  }
  if (typeof (Promise as unknown as Record<string, unknown>).try !== 'function') {
    (Promise as unknown as Record<string, unknown>).try = function (
      fn: (...args: unknown[]) => unknown,
      ...args: unknown[]
    ) {
      return new Promise((resolve) => resolve((fn as (...a: unknown[]) => unknown)(...args)));
    };
  }
  if (typeof (URL as unknown as Record<string, unknown>).parse !== 'function') {
    (URL as unknown as Record<string, unknown>).parse = function (url: string, base?: string) {
      try {
        return new URL(url, base);
      } catch {
        return null;
      }
    };
  }
  if (typeof (Promise as unknown as Record<string, unknown>).withResolvers !== 'function') {
    (Promise as unknown as Record<string, unknown>).withResolvers = function () {
      let resolve!: (v: unknown) => void;
      let reject!: (r?: unknown) => void;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
  }
  if (typeof (RegExp as unknown as Record<string, unknown>).escape !== 'function') {
    (RegExp as unknown as Record<string, unknown>).escape = function (str: string) {
      return String(str).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
    };
  }
  const mapProto = Map.prototype as unknown as Record<string, unknown>;
  if (typeof mapProto.getOrInsertComputed !== 'function') {
    mapProto.getOrInsertComputed = function (this: Map<unknown, unknown>, key: unknown, cb: (k: unknown) => unknown) {
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
}

applyPolyfills();
