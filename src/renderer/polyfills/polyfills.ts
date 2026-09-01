// src/renderer/polyfills/polyfills.ts
// Centralized polyfills for PDF.js v5+ in Electron's Chromium runtime.
// Each polyfill is feature-detected and only applied when the native implementation
// is missing. This avoids unnecessary prototype patching in modern Electron (Chromium 125+)
// where most of these TC39 proposals are already implemented.
// See SEC-6 remediation: prototype patching is now scoped, documented, and type-checked.

/**
 * Apply ECMAScript polyfills required by PDF.js v5+.
 * All patches are feature-detected: they only install when the native API is absent,
 * so on modern Electron (Chromium >=125, Electron >=30) most of this becomes a no-op.
 * This function is safe to call in both isolated (preload) and main world contexts.
 */
export function applyPolyfills(): void {
  // 1. Math.sumPrecise (TC39 Stage 3, Chromium 119+). Needed for PDF.js numeric precision.
  // Guard: only if missing (Electron 29 bundles Chromium 122, which lacks it initially).
  if (typeof (Math as unknown as Record<string, unknown>).sumPrecise !== 'function') {
    (Math as unknown as Record<string, unknown>).sumPrecise = function (iterable: Iterable<unknown>) {
      let sum = 0;
      for (const num of iterable) {
        sum += Number(num);
      }
      return sum;
    };
  }

  // 2. Promise.try (TC39 Stage 3, Chromium 122+). PDF.js uses it for async init.
  if (typeof (Promise as unknown as Record<string, unknown>).try !== 'function') {
    (Promise as unknown as Record<string, unknown>).try = function (
      fn: (...args: unknown[]) => unknown,
      ...args: unknown[]
    ) {
      return new Promise((resolve) => {
        resolve((fn as (...a: unknown[]) => unknown)(...args));
      });
    };
  }

  // 3. URL.parse (Baseline 2024, Chromium 126+, Electron 31+). PDF.js uses for URL resolution.
  if (typeof (URL as unknown as Record<string, unknown>).parse !== 'function') {
    (URL as unknown as Record<string, unknown>).parse = function (url: string, base?: string) {
      try {
        return new URL(url, base);
      } catch {
        return null;
      }
    };
  }

  // 4. Promise.withResolvers (ECMAScript 2024, Chromium 119+). Used by PDF.js worker code.
  if (typeof (Promise as unknown as Record<string, unknown>).withResolvers !== 'function') {
    (Promise as unknown as Record<string, unknown>).withResolvers = function () {
      let resolve!: (value: unknown) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }

  // 5. RegExp.escape (TC39 Stage 3, Chromium 130+). Used by PDF.js text handling.
  if (typeof (RegExp as unknown as Record<string, unknown>).escape !== 'function') {
    (RegExp as unknown as Record<string, unknown>).escape = function (str: string) {
      return String(str).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
    };
  }

  // 6. Map.prototype.getOrInsertComputed / getOrInsert (TC39 Stage 3, Chromium 133+)
  const mapProto = Map.prototype as unknown as Record<string, unknown>;
  if (typeof mapProto.getOrInsertComputed !== 'function') {
    mapProto.getOrInsertComputed = function (
      this: Map<unknown, unknown>,
      key: unknown,
      callback: (k: unknown) => unknown
    ) {
      if (this.has(key)) {
        return this.get(key);
      }
      const value = callback(key);
      this.set(key, value);
      return value;
    };
  }
  if (typeof mapProto.getOrInsert !== 'function') {
    mapProto.getOrInsert = function (this: Map<unknown, unknown>, key: unknown, defaultValue: unknown) {
      if (this.has(key)) {
        return this.get(key);
      }
      this.set(key, defaultValue);
      return defaultValue;
    };
  }

  // 7. Set methods (TC39 Set Methods, ECMAScript 2024, Chromium 122+)
  const setProto = Set.prototype as unknown as Record<string, unknown>;
  if (typeof setProto.intersection !== 'function') {
    setProto.intersection = function (this: Set<unknown>, other: Set<unknown> | Iterable<unknown>) {
      const result = new Set<unknown>();
      const otherSet = other instanceof Set ? other : new Set(other);
      for (const item of this) {
        if (otherSet.has(item)) {
          result.add(item);
        }
      }
      return result;
    };
  }
  if (typeof setProto.union !== 'function') {
    setProto.union = function (this: Set<unknown>, other: Iterable<unknown>) {
      const result = new Set(this);
      for (const item of other) {
        result.add(item);
      }
      return result;
    };
  }
  if (typeof setProto.difference !== 'function') {
    setProto.difference = function (this: Set<unknown>, other: Set<unknown> | Iterable<unknown>) {
      const result = new Set(this);
      const otherSet = other instanceof Set ? other : new Set(other);
      for (const item of otherSet) {
        result.delete(item);
      }
      return result;
    };
  }

  // 8. Uint8Array methods (TC39 Uint8Array to/from base64 and hex, Chromium 131+)
  const uint8Proto = Uint8Array.prototype as unknown as Record<string, unknown>;
  if (typeof uint8Proto.toHex !== 'function') {
    uint8Proto.toHex = function (this: Uint8Array) {
      let hex = '';
      for (let i = 0; i < this.length; i++) {
        hex += this[i].toString(16).padStart(2, '0');
      }
      return hex;
    };
  }
  if (typeof uint8Proto.toBase64 !== 'function') {
    uint8Proto.toBase64 = function (this: Uint8Array) {
      let binary = '';
      const bytes: Uint8Array = this;
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    };
  }
  const uint8Ctor = Uint8Array as unknown as Record<string, unknown>;
  if (typeof uint8Ctor.fromHex !== 'function') {
    uint8Ctor.fromHex = function (hexString: string) {
      const bytes = new Uint8Array(hexString.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hexString.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    };
  }
  if (typeof uint8Ctor.fromBase64 !== 'function') {
    uint8Ctor.fromBase64 = function (base64String: string) {
      const binary = atob(base64String);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    };
  }
}

/**
 * Feature-detect whether the current Chromium supports CSS `round()` math function.
 * Chromium 125+ (Electron 31+) natively supports it; earlier versions need the sanitizer.
 */
export function supportsCssRound(): boolean {
  try {
    // Use CSS.supports if available; fallback to false (assume polyfill needed) on older runtimes.
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      return CSS.supports('width', 'round(1px, 1px)');
    }
  } catch {
    // ignore
  }
  return false;
}

export function sanitizeCssValue(val: string): string {
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
