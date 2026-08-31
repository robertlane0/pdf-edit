import {
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
} from 'pdf-lib';

export interface ContentTextReplacement {
  pageIndex: number;
  sourceText: string;
  replacementText: string;
  x?: number;
  y?: number;
}

type TokenType = 'string' | 'hex' | 'number' | 'word' | '[' | ']' | 'other';

interface Token {
  type: TokenType;
  start: number;
  end: number;
  value: string;
}

interface Candidate {
  token: Token;
  index: number;
  x?: number;
  y?: number;
}

const TEXT_SHOW_OPERATORS = new Set(['Tj', 'TJ', "'", '"']);
const TEXT_STATE_OPERATORS = new Set(['Tm', 'Td', 'TD', 'T*']);

function isWhitespace(byte: number): boolean {
  return byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20;
}

function isDelimiter(byte: number): boolean {
  return isWhitespace(byte) || '()<>[]{}/%'.includes(String.fromCharCode(byte));
}

function isNumberStart(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) || byte === 0x2d || byte === 0x2b || byte === 0x2e;
}

function bytesToLatin1(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i += 1) value += String.fromCharCode(bytes[i]);
  return value;
}

function latin1ToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0xff) {
      throw new Error('The replacement text contains characters that cannot be encoded in the existing PDF text run.');
    }
    bytes[i] = code;
  }
  return bytes;
}

function decodeLiteralString(raw: Uint8Array): Uint8Array {
  const out: number[] = [];
  let depth = 0;
  for (let i = 1; i < raw.length - 1; i += 1) {
    const byte = raw[i];
    if (byte === 0x5c) { // backslash
      const next = raw[++i];
      if (next === undefined) break;
      if (next === 0x6e) out.push(0x0a);
      else if (next === 0x72) out.push(0x0d);
      else if (next === 0x74) out.push(0x09);
      else if (next === 0x62) out.push(0x08);
      else if (next === 0x66) out.push(0x0c);
      else if (next === 0x0a) {
        // line continuation
      } else if (next === 0x0d) {
        if (raw[i + 1] === 0x0a) i += 1;
      } else if (next === 0x28 || next === 0x29 || next === 0x5c) out.push(next);
      else if (next >= 0x30 && next <= 0x37) {
        let octal = next - 0x30;
        for (let count = 0; count < 2 && i + 1 < raw.length - 1; count += 1) {
          const digit = raw[i + 1];
          if (digit < 0x30 || digit > 0x37) break;
          i += 1;
          octal = octal * 8 + digit - 0x30;
        }
        out.push(octal & 0xff);
      } else {
        out.push(next);
      }
      continue;
    }
    if (byte === 0x28) depth += 1;
    if (byte === 0x29 && depth > 0) depth -= 1;
    out.push(byte);
  }
  return Uint8Array.from(out);
}

function decodeHexString(raw: Uint8Array): Uint8Array {
  const hexChars: string[] = [];
  for (let i = 1; i < raw.length - 1; i += 1) {
    const char = String.fromCharCode(raw[i]);
    if (/\s/.test(char)) continue;
    hexChars.push(char);
  }
  if (hexChars.length % 2) hexChars.push('0');
  const bytes = new Uint8Array(hexChars.length / 2);
  for (let i = 0; i < hexChars.length; i += 2) {
    const value = Number.parseInt(hexChars[i] + hexChars[i + 1], 16);
    bytes[i / 2] = Number.isFinite(value) ? value : 0;
  }
  return bytes;
}

function encodeLiteralString(value: Uint8Array): Uint8Array {
  const chars: number[] = [0x28];
  for (const byte of value) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      chars.push(0x5c, byte);
    } else if (byte === 0x0a) {
      chars.push(0x5c, 0x6e);
    } else if (byte === 0x0d) {
      chars.push(0x5c, 0x72);
    } else if (byte === 0x09) {
      chars.push(0x5c, 0x74);
    } else {
      chars.push(byte);
    }
  }
  chars.push(0x29);
  return Uint8Array.from(chars);
}

function encodeHexString(value: Uint8Array): Uint8Array {
  const hex = Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
  return new TextEncoder().encode('<' + hex + '>');
}

function tokenize(bytes: Uint8Array): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < bytes.length) {
    while (i < bytes.length && isWhitespace(bytes[i])) i += 1;
    if (i >= bytes.length) break;
    const start = i;
    const byte = bytes[i];

    if (byte === 0x25) { // comment
      i += 1;
      while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i += 1;
      tokens.push({ type: 'other', start, end: i, value: '' });
      continue;
    }

    if (byte === 0x28) { // literal string
      i += 1;
      let nesting = 1;
      while (i < bytes.length && nesting > 0) {
        if (bytes[i] === 0x5c) {
          i += 2;
          continue;
        }
        if (bytes[i] === 0x28) nesting += 1;
        if (bytes[i] === 0x29) nesting -= 1;
        i += 1;
      }
      tokens.push({ type: 'string', start, end: i, value: bytesToLatin1(decodeLiteralString(bytes.subarray(start, i))) });
      continue;
    }

    if (byte === 0x3c && bytes[i + 1] !== 0x3c) { // hex string
      i += 1;
      while (i < bytes.length && bytes[i] !== 0x3e) i += 1;
      if (i < bytes.length) i += 1;
      tokens.push({ type: 'hex', start, end: i, value: bytesToLatin1(decodeHexString(bytes.subarray(start, i))) });
      continue;
    }

    if (byte === 0x5b) {
      i += 1;
      tokens.push({ type: '[', start, end: i, value: '[' });
      continue;
    }
    if (byte === 0x5d) {
      i += 1;
      tokens.push({ type: ']', start, end: i, value: ']' });
      continue;
    }

    if (isNumberStart(byte)) {
      i += 1;
      while (i < bytes.length && !isDelimiter(bytes[i])) i += 1;
      const value = new TextDecoder().decode(bytes.subarray(start, i));
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
        tokens.push({ type: 'number', start, end: i, value });
        continue;
      }
      tokens.push({ type: 'word', start, end: i, value });
      continue;
    }

    if (byte === 0x2f || byte === 0x7c) {
      i += 1;
      while (i < bytes.length && !isDelimiter(bytes[i])) i += 1;
      tokens.push({ type: 'word', start, end: i, value: new TextDecoder().decode(bytes.subarray(start, i)) });
      continue;
    }

    i += 1;
    while (i < bytes.length && !isDelimiter(bytes[i])) i += 1;
    tokens.push({ type: 'word', start, end: i, value: new TextDecoder().decode(bytes.subarray(start, i)) });
  }
  return tokens;
}

function isTextOperand(tokens: Token[], index: number): boolean {
  for (let cursor = index + 1; cursor < Math.min(tokens.length, index + 40); cursor += 1) {
    const token = tokens[cursor];
    if (TEXT_SHOW_OPERATORS.has(token.value)) return true;
    if (token.value === 'BT' || token.value === 'ET') return false;
    if (token.type === 'word' && !['Tr', 'Tf', 'Td', 'TD', 'Tm', 'T*', 'Ts', 'Tw', 'Tc', 'TL', 'Tz', 'q', 'Q'].includes(token.value)) {
      return false;
    }
  }
  return false;
}

function getApproximateTextOrigin(tokens: Token[], index: number): { x?: number; y?: number } {
  for (let cursor = index - 1; cursor >= 0 && index - cursor <= 80; cursor -= 1) {
    const token = tokens[cursor];
    if (token.type !== 'word' || !TEXT_STATE_OPERATORS.has(token.value)) continue;
    if (token.value === 'T*') continue;
    const numbers: number[] = [];
    for (let n = cursor - 1; n >= 0 && numbers.length < (token.value === 'Tm' ? 6 : 2); n -= 1) {
      if (tokens[n].type === 'number') numbers.unshift(Number(tokens[n].value));
      else if (tokens[n].type === 'word' && numbers.length > 0) break;
      else if (tokens[n].type === '[' || tokens[n].type === ']') break;
    }
    if (token.value === 'Tm' && numbers.length >= 6) return { x: numbers[4], y: numbers[5] };
    if ((token.value === 'Td' || token.value === 'TD') && numbers.length >= 2) return { x: numbers[0], y: numbers[1] };
  }
  return {};
}

function distance(a: Candidate, replacement: ContentTextReplacement): number {
  if (replacement.x === undefined || replacement.y === undefined || a.x === undefined || a.y === undefined) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x - replacement.x, a.y - replacement.y);
}

function findTextGroups(tokens: Token[]): Token[][] {
  const groups: Token[][] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === 'Tj' || token.value === "'" || token.value === '"') {
      for (let operand = index - 1; operand >= 0 && index - operand <= 8; operand -= 1) {
        if (tokens[operand].type === 'string' || tokens[operand].type === 'hex') {
          groups.push([tokens[operand]]);
          break;
        }
      }
    } else if (token.value === 'TJ') {
      let close = index - 1;
      while (close >= 0 && tokens[close].type !== ']') close -= 1;
      if (close < 0) continue;
      let open = close - 1;
      while (open >= 0 && tokens[open].type !== '[') open -= 1;
      if (open < 0) continue;
      const strings = tokens.slice(open + 1, close).filter(item => item.type === 'string' || item.type === 'hex');
      if (strings.length > 0) groups.push(strings);
    }
  }
  return groups;
}

function applyReplacementToBytes(bytes: Uint8Array, replacement: ContentTextReplacement): { bytes: Uint8Array; changed: boolean } {
  const tokens = tokenize(bytes);
  const groups = findTextGroups(tokens);
  const candidates: Array<{ group: Token[]; text: string }> = [];

  for (const group of groups) {
    const text = group.map(token => token.value).join('');
    if (text.includes(replacement.sourceText)) candidates.push({ group, text });
  }

  if (candidates.length === 0) return { bytes, changed: false };

  const scored = candidates.map(candidate => {
    const first = candidate.group[0];
    const origin = getApproximateTextOrigin(tokens, tokens.indexOf(first));
    return { ...candidate, x: origin.x, y: origin.y };
  });
  scored.sort((a, b) => {
    const aCandidate = { token: a.group[0], index: tokens.indexOf(a.group[0]), x: a.x, y: a.y };
    const bCandidate = { token: b.group[0], index: tokens.indexOf(b.group[0]), x: b.x, y: b.y };
    return distance(aCandidate, replacement) - distance(bCandidate, replacement);
  });

  const targetGroup = scored[0].group;
  const fullText = scored[0].text;
  const sourceStart = fullText.indexOf(replacement.sourceText);
  const sourceEnd = sourceStart + replacement.sourceText.length;

  let seenChars = 0;
  let firstToken = -1;
  let lastToken = -1;
  let firstLocalStart = 0;
  let lastLocalEnd = 0;
  for (let index = 0; index < targetGroup.length; index += 1) {
    const text = targetGroup[index].value;
    const textStart = seenChars;
    const textEnd = seenChars + text.length;
    if (firstToken < 0 && sourceStart >= textStart && sourceStart < textEnd) {
      firstToken = index;
      firstLocalStart = sourceStart - textStart;
    }
    if (sourceEnd > textStart && sourceEnd <= textEnd) {
      lastToken = index;
      lastLocalEnd = sourceEnd - textStart;
      break;
    }
    seenChars = textEnd;
  }
  if (firstToken < 0 || lastToken < 0) return { bytes, changed: false };

  const firstRaw = bytes.subarray(targetGroup[firstToken].start, targetGroup[firstToken].end);
  const firstDecoded = targetGroup[firstToken].type === 'string' ? decodeLiteralString(firstRaw) : decodeHexString(firstRaw);
  const firstText = bytesToLatin1(firstDecoded);
  const before = firstText.slice(0, firstLocalStart);
  const after = targetGroup[lastToken].value.slice(lastLocalEnd);
  const merged = before + replacement.replacementText + after;
  const mergedBytes = latin1ToBytes(merged);
  const firstEncoded = targetGroup[firstToken].type === 'string' ? encodeLiteralString(mergedBytes) : encodeHexString(mergedBytes);

  const edits: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
  edits.push({ start: targetGroup[firstToken].start, end: targetGroup[firstToken].end, bytes: firstEncoded });
  for (let index = firstToken + 1; index <= lastToken; index += 1) {
    const token = targetGroup[index];
    edits.push({ start: token.start, end: token.end, bytes: token.type === 'string' ? encodeLiteralString(new Uint8Array()) : encodeHexString(new Uint8Array()) });
  }

  edits.sort((a, b) => b.start - a.start);
  let result = bytes;
  for (const edit of edits) {
    const updated = new Uint8Array(result.length - (edit.end - edit.start) + edit.bytes.length);
    updated.set(result.subarray(0, edit.start), 0);
    updated.set(edit.bytes, edit.start);
    updated.set(result.subarray(edit.end), edit.start + edit.bytes.length);
    result = updated;
  }
  return { bytes: result, changed: true };
}

function getContentStreams(pdfDocument: PDFDocument, pageIndex: number): Array<{ ref?: any; stream: PDFRawStream }> {
  const page = pdfDocument.getPages()[pageIndex - 1];
  if (!page) return [];
  const contents = page.node.Contents();
  if (!contents) return [];
  if (contents instanceof PDFArray) {
    const streams: Array<{ ref?: any; stream: PDFRawStream }> = [];
    for (let index = 0; index < contents.size(); index += 1) {
      const refOrObject = contents.get(index);
      const stream = pdfDocument.context.lookupMaybe(refOrObject, PDFStream);
      if (stream instanceof PDFRawStream) streams.push({ ref: refOrObject, stream });
    }
    return streams;
  }
  if (contents instanceof PDFRawStream) return [{ ref: pdfDocument.context.getObjectRef(contents), stream: contents }];
  return [];
}

export async function applyTextReplacementToPDF(
  pdfDocument: PDFDocument,
  replacement: ContentTextReplacement,
): Promise<boolean> {
  if (!replacement.sourceText) throw new Error('Missing source text for PDF edit.');
  const streams = getContentStreams(pdfDocument, replacement.pageIndex);
  let changed = false;

  for (const { ref, stream } of streams) {
    let decoded: Uint8Array;
    try {
      decoded = decodePDFRawStream(stream).decode();
    } catch (error) {
      throw new Error(`Cannot edit page ${replacement.pageIndex}: unsupported PDF content stream encoding.`);
    }
    const result = applyReplacementToBytes(decoded, replacement);
    if (!result.changed) continue;

    const replacementStream = pdfDocument.context.flateStream(result.bytes);
    if (ref) {
      pdfDocument.context.assign(ref, replacementStream);
    } else {
      const page = pdfDocument.getPages()[replacement.pageIndex - 1];
      page.node.set(PDFName.Contents, replacementStream);
    }
    changed = true;
    break;
  }

  return changed;
}
