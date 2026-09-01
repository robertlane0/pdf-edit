// src/shared/types.ts

/**
 * IPC types and payload DTOs shared between main, preload, and renderer processes.
 */

/** Overlay item stored in the virtualization-safe overlay store */
export interface OverlayItem {
  id: string;
  content: string;
}

/** State of overlays for a single PDF page */
export interface PageOverlayState {
  pageIndex: number;
  items: OverlayItem[];
}

/** Payload sent via postMessage when a PDF page finishes rendering */
export interface PageRenderedPayload {
  pageNumber: number;
  scale: number;
  viewport: {
    width: number;
    height: number;
    rotation: number;
  };
}

/** Message envelope for postMessage communication */
export interface PDFAdapterMessage {
  type: 'PDF_PAGE_RENDERED' | 'PDF_DOCUMENT_LOADED' | 'PDF_ANNOTATION_ADDED';
  payload: PageRenderedPayload | Record<string, unknown>;
}

/** Rectangle in PDF coordinate space (bottom-left origin, points) */
export interface PDFRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Color in normalized RGB (0-1 range) */
export interface NormalizedColor {
  r: number;
  g: number;
  b: number;
}

/** Annotation rectangle with color for PDF flattening */
export interface PDFAnnotationRect extends PDFRect {
  pageIndex: number;
  color: NormalizedColor;
}

/** Serializable replacement for text that existed in the source PDF. */
export interface PDFTextEdit extends PDFRect {
  id: string;
  pageIndex: number;
  sourceText: string;
  text: string;
}

/** Maximum number of text edits allowed per IPC call to bound processing time. */
export const MAX_TEXT_EDITS = 5000;

/**
 * Runtime validator for PDFTextEdit payloads crossing the IPC trust boundary.
 * The renderer process is treated as untrusted — type annotations are compile-time
 * only and structured-clone IPC data carries no runtime type guarantees.
 */
export function isValidTextEdit(value: unknown): value is PDFTextEdit {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return false;
  if (typeof v.sourceText !== 'string') return false;
  if (typeof v.text !== 'string') return false;
  if (!Number.isInteger(v.pageIndex) || (v.pageIndex as number) < 1) return false;
  if (typeof v.x !== 'number' || !Number.isFinite(v.x)) return false;
  if (typeof v.y !== 'number' || !Number.isFinite(v.y)) return false;
  if (typeof v.width !== 'number' || !Number.isFinite(v.width)) return false;
  if (typeof v.height !== 'number' || !Number.isFinite(v.height)) return false;
  return true;
}

/**
 * Validates an array of PDFTextEdits and throws a descriptive TypeError for
 * the first malformed entry. Also enforces an upper bound on array length to
 * bound worst-case processing time per IPC call.
 */
export function assertValidTextEdits(edits: unknown): asserts edits is PDFTextEdit[] {
  if (!Array.isArray(edits)) {
    throw new TypeError('Expected text edits to be an array');
  }
  if (edits.length > MAX_TEXT_EDITS) {
    throw new TypeError(`Too many text edits: ${edits.length} exceeds maximum of ${MAX_TEXT_EDITS}`);
  }
  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i] as Record<string, unknown>;
    if (typeof edit !== 'object' || edit === null) {
      throw new TypeError(`Invalid text edit at index ${i}: expected an object`);
    }
    if (typeof edit.id !== 'string') {
      throw new TypeError(`Invalid text edit at index ${i}: "id" must be a string`);
    }
    if (typeof edit.sourceText !== 'string') {
      throw new TypeError(`Invalid text edit at index ${i}: "sourceText" must be a string`);
    }
    if (typeof edit.text !== 'string') {
      throw new TypeError(`Invalid text edit at index ${i}: "text" must be a string`);
    }
    if (!Number.isInteger(edit.pageIndex) || (edit.pageIndex as number) < 1) {
      throw new TypeError(`Invalid text edit at index ${i}: "pageIndex" must be a positive integer`);
    }
    if (typeof edit.x !== 'number' || !Number.isFinite(edit.x)) {
      throw new TypeError(`Invalid text edit at index ${i}: "x" must be a finite number`);
    }
    if (typeof edit.y !== 'number' || !Number.isFinite(edit.y)) {
      throw new TypeError(`Invalid text edit at index ${i}: "y" must be a finite number`);
    }
    if (typeof edit.width !== 'number' || !Number.isFinite(edit.width)) {
      throw new TypeError(`Invalid text edit at index ${i}: "width" must be a finite number`);
    }
    if (typeof edit.height !== 'number' || !Number.isFinite(edit.height)) {
      throw new TypeError(`Invalid text edit at index ${i}: "height" must be a finite number`);
    }
  }
}

/** Extension metadata returned by the extension loader */
export interface ExtensionMetadata {
  id: string;
  name: string;
  version: string;
}

/** IPC channel names */
export const IPC_CHANNELS = {
  EXTENSION_LIST: 'extension:list',
  EXTENSION_SEND_MESSAGE: 'extension:send-message',
  PDF_GET_BYTES: 'pdf:get-bytes',
  PDF_ADD_ANNOTATION: 'pdf:add-annotation',
  PDF_APPLY_TEXT_EDITS: 'pdf:apply-text-edits'
} as const;
