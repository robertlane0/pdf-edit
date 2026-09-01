import { PDFDocument } from 'pdf-lib';
import { applyTextReplacementToPDF, type ContentTextReplacement } from './pdf-text-content';
import type { PDFTextEdit } from './types';

// Re-export the canonical type so existing import paths continue to work.
export type { PDFTextEdit } from './types';

/**
 * Rewrites the page's existing text-showing operator instead of drawing an
 * annotation or a cover rectangle on top of the original PDF content.
 */
export async function applyTextEditsToPDF(
  originalPdfBytes: Uint8Array,
  edits: PDFTextEdit[],
): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(originalPdfBytes, { updateMetadata: false });

  for (const edit of edits) {
    const replacement: ContentTextReplacement = {
      pageIndex: edit.pageIndex,
      sourceText: edit.sourceText,
      replacementText: edit.text,
      x: edit.x,
      y: edit.y,
    };
    const changed = await applyTextReplacementToPDF(pdfDocument, replacement);
    if (!changed) {
      throw new Error(`Unable to locate the original PDF text run "${edit.sourceText}" on page ${edit.pageIndex}.`);
    }
  }

  return pdfDocument.save({ useObjectStreams: false });
}
