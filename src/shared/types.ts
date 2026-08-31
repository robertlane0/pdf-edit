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
  PDF_ADD_ANNOTATION: 'pdf:add-annotation'
} as const;
