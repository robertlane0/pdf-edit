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
