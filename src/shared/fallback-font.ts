import { PDFDocument, PDFFont } from 'pdf-lib';
import * as fontkit from '@pdf-lib/fontkit';
import * as fs from 'fs';
import * as path from 'path';

let cachedFontBytes: Uint8Array | null = null;

function findFallbackFontPath(): string | null {
  const candidates = [
    path.join(__dirname, '../../src/assets/fonts/LiberationSans-Regular.ttf'),
    path.join(__dirname, '../assets/fonts/LiberationSans-Regular.ttf'),
    path.join(__dirname, '../../assets/fonts/LiberationSans-Regular.ttf'),
    path.join(process.cwd(), 'src/assets/fonts/LiberationSans-Regular.ttf'),
    path.join(process.cwd(), 'dist/assets/fonts/LiberationSans-Regular.ttf'),
    '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function loadFallbackFontBytes(): Uint8Array {
  if (cachedFontBytes) return cachedFontBytes;
  const fontPath = findFallbackFontPath();
  if (!fontPath) {
    throw new Error('LiberationSans-Regular.ttf not found. Checked: src/assets/fonts, dist/assets/fonts, /usr/share/fonts');
  }
  const bytes = fs.readFileSync(fontPath);
  cachedFontBytes = new Uint8Array(bytes);
  return cachedFontBytes;
}

let fallbackFontCache = new WeakMap<PDFDocument, PDFFont>();

export async function getFallbackFont(pdfDocument: PDFDocument): Promise<PDFFont> {
  const cached = fallbackFontCache.get(pdfDocument);
  if (cached) return cached;

  // Register fontkit if not already registered
  try {
    (pdfDocument as unknown as { registerFontkit: (fk: unknown) => void }).registerFontkit(fontkit);
  } catch {
    // fontkit may already be registered, ignore
  }

  const fontBytes = loadFallbackFontBytes();
  const font = await pdfDocument.embedFont(fontBytes, { subset: true });
  fallbackFontCache.set(pdfDocument, font);
  return font;
}

export function isFallbackEnabled(useFallbackFont?: boolean): boolean {
  return !!useFallbackFont;
}
