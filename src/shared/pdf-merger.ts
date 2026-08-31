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
