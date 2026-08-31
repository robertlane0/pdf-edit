import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * A replacement for a single text-layer run. Coordinates are PDF points and
 * use the PDF bottom-left origin so they remain stable across viewer zooms.
 */
export interface PDFTextEdit {
  id: string;
  pageIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontStyle: 'normal' | 'bold' | 'italic' | 'boldItalic';
  color: { r: number; g: number; b: number };
}

function getStandardFontName(style: PDFTextEdit['fontStyle']): StandardFonts {
  switch (style) {
    case 'bold':
      return StandardFonts.HelveticaBold;
    case 'italic':
      return StandardFonts.HelveticaOblique;
    case 'boldItalic':
      return StandardFonts.HelveticaBoldOblique;
    default:
      return StandardFonts.Helvetica;
  }
}

/**
 * Applies text edits without altering the original page content stream. PDF
 * content cannot be reliably edited in place, so the original run is painted
 * out and the replacement is drawn at the same PDF-space position.
 */
export async function applyTextEditsToPDF(
  originalPdfBytes: Uint8Array,
  edits: PDFTextEdit[]
): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(originalPdfBytes, {
    updateMetadata: false,
  });
  const pages = pdfDocument.getPages();
  const fonts = new Map<PDFTextEdit['fontStyle'], Awaited<ReturnType<typeof pdfDocument.embedFont>>>();

  for (const edit of edits) {
    const page = pages[edit.pageIndex - 1];
    if (!page || !edit.text) continue;

    let font = fonts.get(edit.fontStyle);
    if (!font) {
      font = await pdfDocument.embedFont(getStandardFontName(edit.fontStyle));
      fonts.set(edit.fontStyle, font);
    }

    // A small bleed avoids leaving antialiased pixels from the old glyphs.
    const bleed = Math.max(0.5, edit.fontSize * 0.08);
    page.drawRectangle({
      x: edit.x - bleed,
      y: edit.y - bleed,
      width: edit.width + bleed * 2,
      height: edit.height + bleed * 2,
      color: rgb(1, 1, 1),
    });

    // pdf-lib positions text at its baseline. The PDF.js text-layer bounds
    // represent the glyph box, so this places the Helvetica baseline within it.
    const baseline = edit.y + Math.max(edit.fontSize * 0.18, edit.height - edit.fontSize * 0.82);
    const lineHeight = edit.fontSize * 1.2;
    for (const [lineIndex, line] of edit.text.split(/\r?\n/).entries()) {
      page.drawText(line, {
        x: edit.x,
        y: baseline - lineIndex * lineHeight,
        size: edit.fontSize,
        font,
        color: rgb(edit.color.r, edit.color.g, edit.color.b),
      });
    }
  }

  return pdfDocument.save();
}
