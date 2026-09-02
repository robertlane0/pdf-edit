import { PDFDocument, rgb } from 'pdf-lib';
import { applyTextReplacementToPDF, type ContentTextReplacement } from './pdf-text-content';
import type { PDFTextEdit } from './types';
import { getFallbackFont } from './fallback-font';

// Re-export the canonical type so existing import paths continue to work.
export type { PDFTextEdit } from './types';

/**
 * Rewrites the page's existing text-showing operator instead of drawing an
 * annotation or a cover rectangle on top of the original PDF content.
 * If the edit requires glyphs not available in the original subset font and
 * useFallbackFont is true, it falls back to white-rectangle cover + drawing
 * with LiberationSans (subset:true) so the PDF renders correctly.
 */
export async function applyTextEditsToPDF(
  originalPdfBytes: Uint8Array,
  edits: PDFTextEdit[],
  options?: { useFallbackFont?: boolean },
): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(originalPdfBytes, { updateMetadata: false });
  const useFallback = !!options?.useFallbackFont;
  let fallbackFont: Awaited<ReturnType<typeof getFallbackFont>> | null = null;

  const getFallback = async () => {
    if (!fallbackFont) fallbackFont = await getFallbackFont(pdfDocument);
    return fallbackFont;
  };

  for (const edit of edits) {
    const replacement: ContentTextReplacement = {
      pageIndex: edit.pageIndex,
      sourceText: edit.sourceText,
      replacementText: edit.text,
      x: edit.x,
      y: edit.y,
    };

    // Deletion (empty text) is always handled via low-level path (allowed even for composite)
    // so we try that first regardless of fallback setting.
    let didFallback = false;
    try {
      const changed = await applyTextReplacementToPDF(pdfDocument, replacement);
      if (!changed) {
        throw new Error(`Unable to locate the original PDF text run "${edit.sourceText}" on page ${edit.pageIndex}.`);
      }
      continue; // success via low-level path
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isEncodingOrCompositeError =
        msg.includes('not encoded in font') ||
        msg.includes('composite font') ||
        msg.includes('Cannot encode replacement text');

      // If fallback is disabled, or error is not due to missing glyph/composite (e.g., locate failure), rethrow
      if (!useFallback || !isEncodingOrCompositeError) {
        throw error;
      }

      // Fallback path: white-cover + draw with LiberationSans
      // This handles subset missing glyphs (U/Y/H/space) and composite fonts.
      didFallback = true;
    }

    if (didFallback) {
      // First, delete the original text run via low-level path (empty replacement is always allowed, even for subset/composite)
      // This ensures the original "Languages" bytes are removed so pdftotext doesn't extract both old and new.
      try {
        const deletion: ContentTextReplacement = {
          pageIndex: edit.pageIndex,
          sourceText: edit.sourceText,
          replacementText: '',
          x: edit.x,
          y: edit.y,
        };
        await applyTextReplacementToPDF(pdfDocument, deletion);
      } catch {
        // If deletion fails (e.g., already deleted or not found), fall through to just covering with white
      }

      const page = pdfDocument.getPages()[edit.pageIndex - 1];
      if (!page) throw new Error(`Page ${edit.pageIndex} not found for fallback rendering`);

      const font = await getFallback();

      // Use edit's fontSize or fallback to 12; height is bbox height, fontSize is ~0.8*height
      const fontSize =
        typeof edit.fontSize === 'number' && Number.isFinite(edit.fontSize) && edit.fontSize > 0
          ? edit.fontSize
          : edit.height > 0
            ? edit.height * 0.8
            : 12;
      const color =
        edit.color && typeof edit.color.r === 'number' && Number.isFinite(edit.color.r)
          ? rgb(edit.color.r, edit.color.g, edit.color.b)
          : rgb(0, 0, 0);

      // Measure new text width to size the white cover to avoid leftover glyphs and to cover overflow
      let newTextWidth = edit.width;
      try {
        newTextWidth = (font as unknown as { widthOfTextAtSize: (t: string, s: number) => number }).widthOfTextAtSize(edit.text, fontSize);
      } catch {
        // fallback to original width
      }

      // White rectangle to hide original text. Cover the max of original and new width, with a small padding.
      // Use original x,y as lower-left; expand slightly to ensure full coverage.
      const coverX = edit.x - 1;
      const coverY = edit.y - 1;
      const coverWidth = Math.max(edit.width, newTextWidth) + 2;
      const coverHeight = Math.max(edit.height, fontSize * 1.2) + 2;

      page.drawRectangle({
        x: coverX,
        y: coverY,
        width: coverWidth,
        height: coverHeight,
        color: rgb(1, 1, 1),
        borderWidth: 0,
        opacity: 1,
      });

      // Draw new text. y is lower-left of bbox, but drawText expects baseline.
      // Baseline is ~0.2*fontSize above lower-left for most fonts; we approximate by using edit.y + (coverHeight - fontSize)/2
      // For titles, using edit.y directly is close enough; we add a small descent offset.
      const textY = edit.y + Math.max(0, (coverHeight - fontSize) / 2 - 1);
      const textX = edit.x;

      page.drawText(edit.text, {
        x: textX,
        y: textY,
        size: fontSize,
        font,
        color,
        lineHeight: 1,
        maxWidth: coverWidth,
      });
    }
  }

  return pdfDocument.save({ useObjectStreams: false });
}
