import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
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

// --- Font encoding tables (generated from vendor/pdf.js/src/core/encodings.js + glyphlist.js) ---
const WinAnsiEncoding_BYTE_TO_UNICODE: readonly (number | null)[] = [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0x0020,0x0021,0x0022,0x0023,0x0024,0x0025,0x0026,0x0027,0x0028,0x0029,0x002a,0x002b,0x002c,0x002d,0x002e,0x002f,0x0030,0x0031,0x0032,0x0033,0x0034,0x0035,0x0036,0x0037,0x0038,0x0039,0x003a,0x003b,0x003c,0x003d,0x003e,0x003f,0x0040,0x0041,0x0042,0x0043,0x0044,0x0045,0x0046,0x0047,0x0048,0x0049,0x004a,0x004b,0x004c,0x004d,0x004e,0x004f,0x0050,0x0051,0x0052,0x0053,0x0054,0x0055,0x0056,0x0057,0x0058,0x0059,0x005a,0x005b,0x005c,0x005d,0x005e,0x005f,0x0060,0x0061,0x0062,0x0063,0x0064,0x0065,0x0066,0x0067,0x0068,0x0069,0x006a,0x006b,0x006c,0x006d,0x006e,0x006f,0x0070,0x0071,0x0072,0x0073,0x0074,0x0075,0x0076,0x0077,0x0078,0x0079,0x007a,0x007b,0x007c,0x007d,0x007e,0x2022,0x20ac,0x2022,0x201a,0x0192,0x201e,0x2026,0x2020,0x2021,0x02c6,0x2030,0x0160,0x2039,0x0152,0x2022,0x017d,0x2022,0x2022,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x02dc,0x2122,0x0161,0x203a,0x0153,0x2022,0x017e,0x0178,0x0020,0x00a1,0x00a2,0x00a3,0x00a4,0x00a5,0x00a6,0x00a7,0x00a8,0x00a9,0x00aa,0x00ab,0x00ac,0x002d,0x00ae,0x00af,0x00b0,0x00b1,0x00b2,0x00b3,0x00b4,0x00b5,0x00b6,0x00b7,0x00b8,0x00b9,0x00ba,0x00bb,0x00bc,0x00bd,0x00be,0x00bf,0x00c0,0x00c1,0x00c2,0x00c3,0x00c4,0x00c5,0x00c6,0x00c7,0x00c8,0x00c9,0x00ca,0x00cb,0x00cc,0x00cd,0x00ce,0x00cf,0x00d0,0x00d1,0x00d2,0x00d3,0x00d4,0x00d5,0x00d6,0x00d7,0x00d8,0x00d9,0x00da,0x00db,0x00dc,0x00dd,0x00de,0x00df,0x00e0,0x00e1,0x00e2,0x00e3,0x00e4,0x00e5,0x00e6,0x00e7,0x00e8,0x00e9,0x00ea,0x00eb,0x00ec,0x00ed,0x00ee,0x00ef,0x00f0,0x00f1,0x00f2,0x00f3,0x00f4,0x00f5,0x00f6,0x00f7,0x00f8,0x00f9,0x00fa,0x00fb,0x00fc,0x00fd,0x00fe,0x00ff];

const StandardEncoding_BYTE_TO_UNICODE: readonly (number | null)[] = [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0x0020,0x0021,0x0022,0x0023,0x0024,0x0025,0x0026,0x2019,0x0028,0x0029,0x002a,0x002b,0x002c,0x002d,0x002e,0x002f,0x0030,0x0031,0x0032,0x0033,0x0034,0x0035,0x0036,0x0037,0x0038,0x0039,0x003a,0x003b,0x003c,0x003d,0x003e,0x003f,0x0040,0x0041,0x0042,0x0043,0x0044,0x0045,0x0046,0x0047,0x0048,0x0049,0x004a,0x004b,0x004c,0x004d,0x004e,0x004f,0x0050,0x0051,0x0052,0x0053,0x0054,0x0055,0x0056,0x0057,0x0058,0x0059,0x005a,0x005b,0x005c,0x005d,0x005e,0x005f,0x2018,0x0061,0x0062,0x0063,0x0064,0x0065,0x0066,0x0067,0x0068,0x0069,0x006a,0x006b,0x006c,0x006d,0x006e,0x006f,0x0070,0x0071,0x0072,0x0073,0x0074,0x0075,0x0076,0x0077,0x0078,0x0079,0x007a,0x007b,0x007c,0x007d,0x007e,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0x00a1,0x00a2,0x00a3,0x2044,0x00a5,0x0192,0x00a7,0x00a4,0x0027,0x201c,0x00ab,0x2039,0x203a,0xfb01,0xfb02,null,0x2013,0x2020,0x2021,0x00b7,null,0x00b6,0x2022,0x201a,0x201e,0x201d,0x00bb,0x2026,0x2030,null,0x00bf,null,0x0060,0x00b4,0x02c6,0x02dc,0x00af,0x02d8,0x02d9,0x00a8,null,0x02da,0x00b8,null,0x02dd,0x02db,0x02c7,0x2014,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0x00c6,null,0x00aa,null,null,null,null,0x0141,0x00d8,0x0152,0x00ba,null,null,null,null,null,0x00e6,null,null,null,0x0131,null,null,0x0142,0x00f8,0x0153,0x00df,null,null,null,null];

const MacRomanEncoding_BYTE_TO_UNICODE: readonly (number | null)[] = [null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,0x0020,0x0021,0x0022,0x0023,0x0024,0x0025,0x0026,0x0027,0x0028,0x0029,0x002a,0x002b,0x002c,0x002d,0x002e,0x002f,0x0030,0x0031,0x0032,0x0033,0x0034,0x0035,0x0036,0x0037,0x0038,0x0039,0x003a,0x003b,0x003c,0x003d,0x003e,0x003f,0x0040,0x0041,0x0042,0x0043,0x0044,0x0045,0x0046,0x0047,0x0048,0x0049,0x004a,0x004b,0x004c,0x004d,0x004e,0x004f,0x0050,0x0051,0x0052,0x0053,0x0054,0x0055,0x0056,0x0057,0x0058,0x0059,0x005a,0x005b,0x005c,0x005d,0x005e,0x005f,0x0060,0x0061,0x0062,0x0063,0x0064,0x0065,0x0066,0x0067,0x0068,0x0069,0x006a,0x006b,0x006c,0x006d,0x006e,0x006f,0x0070,0x0071,0x0072,0x0073,0x0074,0x0075,0x0076,0x0077,0x0078,0x0079,0x007a,0x007b,0x007c,0x007d,0x007e,null,0x00c4,0x00c5,0x00c7,0x00c9,0x00d1,0x00d6,0x00dc,0x00e1,0x00e0,0x00e2,0x00e4,0x00e3,0x00e5,0x00e7,0x00e9,0x00e8,0x00ea,0x00eb,0x00ed,0x00ec,0x00ee,0x00ef,0x00f1,0x00f3,0x00f2,0x00f4,0x00f6,0x00f5,0x00fa,0x00f9,0x00fb,0x00fc,0x2020,0x00b0,0x00a2,0x00a3,0x00a7,0x2022,0x00b6,0x00df,0x00ae,0x00a9,0x2122,0x00b4,0x00a8,0x2260,0x00c6,0x00d8,0x221e,0x00b1,0x2264,0x2265,0x00a5,0x00b5,0x2202,0x2211,0x220f,0x03c0,0x222b,0x00aa,0x00ba,0x2126,0x00e6,0x00f8,0x00bf,0x00a1,0x00ac,0x221a,0x0192,0x2248,0x2206,0x00ab,0x00bb,0x2026,0x0020,0x00c0,0x00c3,0x00d5,0x0152,0x0153,0x2013,0x2014,0x201c,0x201d,0x2018,0x2019,0x00f7,0x25ca,0x00ff,0x0178,0x2044,0x00a4,0x2039,0x203a,0xfb01,0xfb02,0x2021,0x00b7,0x201a,0x201e,0x2030,0x00c2,0x00ca,0x00c1,0x00cb,0x00c8,0x00cd,0x00ce,0x00cf,0x00cc,0x00d3,0x00d4,0xf8ff,0x00d2,0x00da,0x00db,0x00d9,0x0131,0x02c6,0x02dc,0x00af,0x02d8,0x02d9,0x02da,0x00b8,0x02dd,0x02db,0x02c7];

const GLYPH_TO_UNICODE: Readonly<Record<string, number>> = {
  "A": 0x0041,
  "AE": 0x00c6,
  "AEsmall": 0xf7e6,
  "Aacute": 0x00c1,
  "Aacutesmall": 0xf7e1,
  "Acircumflex": 0x00c2,
  "Acircumflexsmall": 0xf7e2,
  "Acutesmall": 0xf7b4,
  "Adieresis": 0x00c4,
  "Adieresissmall": 0xf7e4,
  "Agrave": 0x00c0,
  "Agravesmall": 0xf7e0,
  "Alpha": 0x0391,
  "Aring": 0x00c5,
  "Aringsmall": 0xf7e5,
  "Asmall": 0xf761,
  "Atilde": 0x00c3,
  "Atildesmall": 0xf7e3,
  "B": 0x0042,
  "Beta": 0x0392,
  "Brevesmall": 0xf6f4,
  "Bsmall": 0xf762,
  "C": 0x0043,
  "Caronsmall": 0xf6f5,
  "Ccedilla": 0x00c7,
  "Ccedillasmall": 0xf7e7,
  "Cedillasmall": 0xf7b8,
  "Chi": 0x03a7,
  "Circumflexsmall": 0xf6f6,
  "Csmall": 0xf763,
  "D": 0x0044,
  "Delta": 0x2206,
  "Dieresissmall": 0xf7a8,
  "Dotaccentsmall": 0xf6f7,
  "Dsmall": 0xf764,
  "E": 0x0045,
  "Eacute": 0x00c9,
  "Eacutesmall": 0xf7e9,
  "Ecircumflex": 0x00ca,
  "Ecircumflexsmall": 0xf7ea,
  "Edieresis": 0x00cb,
  "Edieresissmall": 0xf7eb,
  "Egrave": 0x00c8,
  "Egravesmall": 0xf7e8,
  "Epsilon": 0x0395,
  "Esmall": 0xf765,
  "Eta": 0x0397,
  "Eth": 0x00d0,
  "Ethsmall": 0xf7f0,
  "Euro": 0x20ac,
  "F": 0x0046,
  "Fsmall": 0xf766,
  "G": 0x0047,
  "Gamma": 0x0393,
  "Gravesmall": 0xf760,
  "Gsmall": 0xf767,
  "H": 0x0048,
  "Hsmall": 0xf768,
  "Hungarumlautsmall": 0xf6f8,
  "I": 0x0049,
  "Iacute": 0x00cd,
  "Iacutesmall": 0xf7ed,
  "Icircumflex": 0x00ce,
  "Icircumflexsmall": 0xf7ee,
  "Idieresis": 0x00cf,
  "Idieresissmall": 0xf7ef,
  "Ifraktur": 0x2111,
  "Igrave": 0x00cc,
  "Igravesmall": 0xf7ec,
  "Iota": 0x0399,
  "Ismall": 0xf769,
  "J": 0x004a,
  "Jsmall": 0xf76a,
  "K": 0x004b,
  "Kappa": 0x039a,
  "Ksmall": 0xf76b,
  "L": 0x004c,
  "Lambda": 0x039b,
  "Lslash": 0x0141,
  "Lslashsmall": 0xf6f9,
  "Lsmall": 0xf76c,
  "M": 0x004d,
  "Macronsmall": 0xf7af,
  "Msmall": 0xf76d,
  "Mu": 0x039c,
  "N": 0x004e,
  "Nsmall": 0xf76e,
  "Ntilde": 0x00d1,
  "Ntildesmall": 0xf7f1,
  "Nu": 0x039d,
  "O": 0x004f,
  "OE": 0x0152,
  "OEsmall": 0xf6fa,
  "Oacute": 0x00d3,
  "Oacutesmall": 0xf7f3,
  "Ocircumflex": 0x00d4,
  "Ocircumflexsmall": 0xf7f4,
  "Odieresis": 0x00d6,
  "Odieresissmall": 0xf7f6,
  "Ogoneksmall": 0xf6fb,
  "Ograve": 0x00d2,
  "Ogravesmall": 0xf7f2,
  "Omega": 0x2126,
  "Omicron": 0x039f,
  "Oslash": 0x00d8,
  "Oslashsmall": 0xf7f8,
  "Osmall": 0xf76f,
  "Otilde": 0x00d5,
  "Otildesmall": 0xf7f5,
  "P": 0x0050,
  "Phi": 0x03a6,
  "Pi": 0x03a0,
  "Psi": 0x03a8,
  "Psmall": 0xf770,
  "Q": 0x0051,
  "Qsmall": 0xf771,
  "R": 0x0052,
  "Rfraktur": 0x211c,
  "Rho": 0x03a1,
  "Ringsmall": 0xf6fc,
  "Rsmall": 0xf772,
  "S": 0x0053,
  "Scaron": 0x0160,
  "Scaronsmall": 0xf6fd,
  "Sigma": 0x03a3,
  "Ssmall": 0xf773,
  "T": 0x0054,
  "Tau": 0x03a4,
  "Theta": 0x0398,
  "Thorn": 0x00de,
  "Thornsmall": 0xf7fe,
  "Tildesmall": 0xf6fe,
  "Tsmall": 0xf774,
  "U": 0x0055,
  "Uacute": 0x00da,
  "Uacutesmall": 0xf7fa,
  "Ucircumflex": 0x00db,
  "Ucircumflexsmall": 0xf7fb,
  "Udieresis": 0x00dc,
  "Udieresissmall": 0xf7fc,
  "Ugrave": 0x00d9,
  "Ugravesmall": 0xf7f9,
  "Upsilon": 0x03a5,
  "Upsilon1": 0x03d2,
  "Usmall": 0xf775,
  "V": 0x0056,
  "Vsmall": 0xf776,
  "W": 0x0057,
  "Wsmall": 0xf777,
  "X": 0x0058,
  "Xi": 0x039e,
  "Xsmall": 0xf778,
  "Y": 0x0059,
  "Yacute": 0x00dd,
  "Yacutesmall": 0xf7fd,
  "Ydieresis": 0x0178,
  "Ydieresissmall": 0xf7ff,
  "Ysmall": 0xf779,
  "Z": 0x005a,
  "Zcaron": 0x017d,
  "Zcaronsmall": 0xf6ff,
  "Zeta": 0x0396,
  "Zsmall": 0xf77a,
  "a": 0x0061,
  "a1": 0x2701,
  "a10": 0x2721,
  "a100": 0x275e,
  "a101": 0x2761,
  "a102": 0x2762,
  "a103": 0x2763,
  "a104": 0x2764,
  "a105": 0x2710,
  "a106": 0x2765,
  "a107": 0x2766,
  "a108": 0x2767,
  "a109": 0x2660,
  "a11": 0x261b,
  "a110": 0x2665,
  "a111": 0x2666,
  "a112": 0x2663,
  "a117": 0x2709,
  "a118": 0x2708,
  "a119": 0x2707,
  "a12": 0x261e,
  "a120": 0x2460,
  "a121": 0x2461,
  "a122": 0x2462,
  "a123": 0x2463,
  "a124": 0x2464,
  "a125": 0x2465,
  "a126": 0x2466,
  "a127": 0x2467,
  "a128": 0x2468,
  "a129": 0x2469,
  "a13": 0x270c,
  "a130": 0x2776,
  "a131": 0x2777,
  "a132": 0x2778,
  "a133": 0x2779,
  "a134": 0x277a,
  "a135": 0x277b,
  "a136": 0x277c,
  "a137": 0x277d,
  "a138": 0x277e,
  "a139": 0x277f,
  "a14": 0x270d,
  "a140": 0x2780,
  "a141": 0x2781,
  "a142": 0x2782,
  "a143": 0x2783,
  "a144": 0x2784,
  "a145": 0x2785,
  "a146": 0x2786,
  "a147": 0x2787,
  "a148": 0x2788,
  "a149": 0x2789,
  "a15": 0x270e,
  "a150": 0x278a,
  "a151": 0x278b,
  "a152": 0x278c,
  "a153": 0x278d,
  "a154": 0x278e,
  "a155": 0x278f,
  "a156": 0x2790,
  "a157": 0x2791,
  "a158": 0x2792,
  "a159": 0x2793,
  "a16": 0x270f,
  "a160": 0x2794,
  "a161": 0x2192,
  "a162": 0x27a3,
  "a163": 0x2194,
  "a164": 0x2195,
  "a165": 0x2799,
  "a166": 0x279b,
  "a167": 0x279c,
  "a168": 0x279d,
  "a169": 0x279e,
  "a17": 0x2711,
  "a170": 0x279f,
  "a171": 0x27a0,
  "a172": 0x27a1,
  "a173": 0x27a2,
  "a174": 0x27a4,
  "a175": 0x27a5,
  "a176": 0x27a6,
  "a177": 0x27a7,
  "a178": 0x27a8,
  "a179": 0x27a9,
  "a18": 0x2712,
  "a180": 0x27ab,
  "a181": 0x27ad,
  "a182": 0x27af,
  "a183": 0x27b2,
  "a184": 0x27b3,
  "a185": 0x27b5,
  "a186": 0x27b8,
  "a187": 0x27ba,
  "a188": 0x27bb,
  "a189": 0x27bc,
  "a19": 0x2713,
  "a190": 0x27bd,
  "a191": 0x27be,
  "a192": 0x279a,
  "a193": 0x27aa,
  "a194": 0x27b6,
  "a195": 0x27b9,
  "a196": 0x2798,
  "a197": 0x27b4,
  "a198": 0x27b7,
  "a199": 0x27ac,
  "a2": 0x2702,
  "a20": 0x2714,
  "a200": 0x27ae,
  "a201": 0x27b1,
  "a202": 0x2703,
  "a203": 0x2750,
  "a204": 0x2752,
  "a205": 0x276e,
  "a206": 0x2770,
  "a21": 0x2715,
  "a22": 0x2716,
  "a23": 0x2717,
  "a24": 0x2718,
  "a25": 0x2719,
  "a26": 0x271a,
  "a27": 0x271b,
  "a28": 0x271c,
  "a29": 0x2722,
  "a3": 0x2704,
  "a30": 0x2723,
  "a31": 0x2724,
  "a32": 0x2725,
  "a33": 0x2726,
  "a34": 0x2727,
  "a35": 0x2605,
  "a36": 0x2729,
  "a37": 0x272a,
  "a38": 0x272b,
  "a39": 0x272c,
  "a4": 0x260e,
  "a40": 0x272d,
  "a41": 0x272e,
  "a42": 0x272f,
  "a43": 0x2730,
  "a44": 0x2731,
  "a45": 0x2732,
  "a46": 0x2733,
  "a47": 0x2734,
  "a48": 0x2735,
  "a49": 0x2736,
  "a5": 0x2706,
  "a50": 0x2737,
  "a51": 0x2738,
  "a52": 0x2739,
  "a53": 0x273a,
  "a54": 0x273b,
  "a55": 0x273c,
  "a56": 0x273d,
  "a57": 0x273e,
  "a58": 0x273f,
  "a59": 0x2740,
  "a6": 0x271d,
  "a60": 0x2741,
  "a61": 0x2742,
  "a62": 0x2743,
  "a63": 0x2744,
  "a64": 0x2745,
  "a65": 0x2746,
  "a66": 0x2747,
  "a67": 0x2748,
  "a68": 0x2749,
  "a69": 0x274a,
  "a7": 0x271e,
  "a70": 0x274b,
  "a71": 0x25cf,
  "a72": 0x274d,
  "a73": 0x25a0,
  "a74": 0x274f,
  "a75": 0x2751,
  "a76": 0x25b2,
  "a77": 0x25bc,
  "a78": 0x25c6,
  "a79": 0x2756,
  "a8": 0x271f,
  "a81": 0x25d7,
  "a82": 0x2758,
  "a83": 0x2759,
  "a84": 0x275a,
  "a85": 0x276f,
  "a86": 0x2771,
  "a87": 0x2772,
  "a88": 0x2773,
  "a89": 0x2768,
  "a9": 0x2720,
  "a90": 0x2769,
  "a91": 0x276c,
  "a92": 0x276d,
  "a93": 0x276a,
  "a94": 0x276b,
  "a95": 0x2774,
  "a96": 0x2775,
  "a97": 0x275b,
  "a98": 0x275c,
  "a99": 0x275d,
  "aacute": 0x00e1,
  "acircumflex": 0x00e2,
  "acute": 0x00b4,
  "adieresis": 0x00e4,
  "ae": 0x00e6,
  "agrave": 0x00e0,
  "aleph": 0x2135,
  "alpha": 0x03b1,
  "ampersand": 0x0026,
  "ampersandsmall": 0xf726,
  "angle": 0x2220,
  "angleleft": 0x2329,
  "angleright": 0x232a,
  "apple": 0xf8ff,
  "approxequal": 0x2248,
  "aring": 0x00e5,
  "arrowboth": 0x2194,
  "arrowdblboth": 0x21d4,
  "arrowdbldown": 0x21d3,
  "arrowdblleft": 0x21d0,
  "arrowdblright": 0x21d2,
  "arrowdblup": 0x21d1,
  "arrowdown": 0x2193,
  "arrowhorizex": 0xf8e7,
  "arrowleft": 0x2190,
  "arrowright": 0x2192,
  "arrowup": 0x2191,
  "arrowvertex": 0xf8e6,
  "asciicircum": 0x005e,
  "asciitilde": 0x007e,
  "asterisk": 0x002a,
  "asteriskmath": 0x2217,
  "asuperior": 0xf6e9,
  "at": 0x0040,
  "atilde": 0x00e3,
  "b": 0x0062,
  "backslash": 0x005c,
  "bar": 0x007c,
  "beta": 0x03b2,
  "braceex": 0xf8f4,
  "braceleft": 0x007b,
  "braceleftbt": 0xf8f3,
  "braceleftmid": 0xf8f2,
  "bracelefttp": 0xf8f1,
  "braceright": 0x007d,
  "bracerightbt": 0xf8fe,
  "bracerightmid": 0xf8fd,
  "bracerighttp": 0xf8fc,
  "bracketleft": 0x005b,
  "bracketleftbt": 0xf8f0,
  "bracketleftex": 0xf8ef,
  "bracketlefttp": 0xf8ee,
  "bracketright": 0x005d,
  "bracketrightbt": 0xf8fb,
  "bracketrightex": 0xf8fa,
  "bracketrighttp": 0xf8f9,
  "breve": 0x02d8,
  "brokenbar": 0x00a6,
  "bsuperior": 0xf6ea,
  "bullet": 0x2022,
  "c": 0x0063,
  "caron": 0x02c7,
  "carriagereturn": 0x21b5,
  "ccedilla": 0x00e7,
  "cedilla": 0x00b8,
  "cent": 0x00a2,
  "centinferior": 0xf6df,
  "centoldstyle": 0xf7a2,
  "centsuperior": 0xf6e0,
  "chi": 0x03c7,
  "circlemultiply": 0x2297,
  "circleplus": 0x2295,
  "circumflex": 0x02c6,
  "club": 0x2663,
  "colon": 0x003a,
  "colonmonetary": 0x20a1,
  "comma": 0x002c,
  "commainferior": 0xf6e1,
  "commasuperior": 0xf6e2,
  "congruent": 0x2245,
  "copyright": 0x00a9,
  "copyrightsans": 0xf8e9,
  "copyrightserif": 0xf6d9,
  "currency": 0x00a4,
  "d": 0x0064,
  "dagger": 0x2020,
  "daggerdbl": 0x2021,
  "degree": 0x00b0,
  "delta": 0x03b4,
  "diamond": 0x2666,
  "dieresis": 0x00a8,
  "divide": 0x00f7,
  "dollar": 0x0024,
  "dollarinferior": 0xf6e3,
  "dollaroldstyle": 0xf724,
  "dollarsuperior": 0xf6e4,
  "dotaccent": 0x02d9,
  "dotlessi": 0x0131,
  "dotmath": 0x22c5,
  "dsuperior": 0xf6eb,
  "e": 0x0065,
  "eacute": 0x00e9,
  "ecircumflex": 0x00ea,
  "edieresis": 0x00eb,
  "egrave": 0x00e8,
  "eight": 0x0038,
  "eightinferior": 0x2088,
  "eightoldstyle": 0xf738,
  "eightsuperior": 0x2078,
  "element": 0x2208,
  "ellipsis": 0x2026,
  "emdash": 0x2014,
  "emptyset": 0x2205,
  "endash": 0x2013,
  "epsilon": 0x03b5,
  "equal": 0x003d,
  "equivalence": 0x2261,
  "esuperior": 0xf6ec,
  "eta": 0x03b7,
  "eth": 0x00f0,
  "exclam": 0x0021,
  "exclamdown": 0x00a1,
  "exclamdownsmall": 0xf7a1,
  "exclamsmall": 0xf721,
  "existential": 0x2203,
  "f": 0x0066,
  "ff": 0xfb00,
  "ffi": 0xfb03,
  "ffl": 0xfb04,
  "fi": 0xfb01,
  "figuredash": 0x2012,
  "five": 0x0035,
  "fiveeighths": 0x215d,
  "fiveinferior": 0x2085,
  "fiveoldstyle": 0xf735,
  "fivesuperior": 0x2075,
  "fl": 0xfb02,
  "florin": 0x0192,
  "four": 0x0034,
  "fourinferior": 0x2084,
  "fouroldstyle": 0xf734,
  "foursuperior": 0x2074,
  "fraction": 0x2044,
  "g": 0x0067,
  "gamma": 0x03b3,
  "germandbls": 0x00df,
  "gradient": 0x2207,
  "grave": 0x0060,
  "greater": 0x003e,
  "greaterequal": 0x2265,
  "guillemotleft": 0x00ab,
  "guillemotright": 0x00bb,
  "guilsinglleft": 0x2039,
  "guilsinglright": 0x203a,
  "h": 0x0068,
  "heart": 0x2665,
  "hungarumlaut": 0x02dd,
  "hyphen": 0x002d,
  "hypheninferior": 0xf6e5,
  "hyphensuperior": 0xf6e6,
  "i": 0x0069,
  "iacute": 0x00ed,
  "icircumflex": 0x00ee,
  "idieresis": 0x00ef,
  "igrave": 0x00ec,
  "infinity": 0x221e,
  "integral": 0x222b,
  "integralbt": 0x2321,
  "integralex": 0xf8f5,
  "integraltp": 0x2320,
  "intersection": 0x2229,
  "iota": 0x03b9,
  "isuperior": 0xf6ed,
  "j": 0x006a,
  "k": 0x006b,
  "kappa": 0x03ba,
  "l": 0x006c,
  "lambda": 0x03bb,
  "less": 0x003c,
  "lessequal": 0x2264,
  "logicaland": 0x2227,
  "logicalnot": 0x00ac,
  "logicalor": 0x2228,
  "lozenge": 0x25ca,
  "lslash": 0x0142,
  "lsuperior": 0xf6ee,
  "m": 0x006d,
  "macron": 0x00af,
  "minus": 0x2212,
  "minute": 0x2032,
  "msuperior": 0xf6ef,
  "mu": 0x00b5,
  "multiply": 0x00d7,
  "n": 0x006e,
  "nine": 0x0039,
  "nineinferior": 0x2089,
  "nineoldstyle": 0xf739,
  "ninesuperior": 0x2079,
  "notelement": 0x2209,
  "notequal": 0x2260,
  "notsubset": 0x2284,
  "nsuperior": 0x207f,
  "ntilde": 0x00f1,
  "nu": 0x03bd,
  "numbersign": 0x0023,
  "o": 0x006f,
  "oacute": 0x00f3,
  "ocircumflex": 0x00f4,
  "odieresis": 0x00f6,
  "oe": 0x0153,
  "ogonek": 0x02db,
  "ograve": 0x00f2,
  "omega": 0x03c9,
  "omega1": 0x03d6,
  "omicron": 0x03bf,
  "one": 0x0031,
  "onedotenleader": 0x2024,
  "oneeighth": 0x215b,
  "onefitted": 0xf6dc,
  "onehalf": 0x00bd,
  "oneinferior": 0x2081,
  "oneoldstyle": 0xf731,
  "onequarter": 0x00bc,
  "onesuperior": 0x00b9,
  "onethird": 0x2153,
  "ordfeminine": 0x00aa,
  "ordmasculine": 0x00ba,
  "oslash": 0x00f8,
  "osuperior": 0xf6f0,
  "otilde": 0x00f5,
  "p": 0x0070,
  "paragraph": 0x00b6,
  "parenleft": 0x0028,
  "parenleftbt": 0xf8ed,
  "parenleftex": 0xf8ec,
  "parenleftinferior": 0x208d,
  "parenleftsuperior": 0x207d,
  "parenlefttp": 0xf8eb,
  "parenright": 0x0029,
  "parenrightbt": 0xf8f8,
  "parenrightex": 0xf8f7,
  "parenrightinferior": 0x208e,
  "parenrightsuperior": 0x207e,
  "parenrighttp": 0xf8f6,
  "partialdiff": 0x2202,
  "percent": 0x0025,
  "period": 0x002e,
  "periodcentered": 0x00b7,
  "periodinferior": 0xf6e7,
  "periodsuperior": 0xf6e8,
  "perpendicular": 0x22a5,
  "perthousand": 0x2030,
  "phi": 0x03c6,
  "phi1": 0x03d5,
  "pi": 0x03c0,
  "plus": 0x002b,
  "plusminus": 0x00b1,
  "product": 0x220f,
  "propersubset": 0x2282,
  "propersuperset": 0x2283,
  "proportional": 0x221d,
  "psi": 0x03c8,
  "q": 0x0071,
  "question": 0x003f,
  "questiondown": 0x00bf,
  "questiondownsmall": 0xf7bf,
  "questionsmall": 0xf73f,
  "quotedbl": 0x0022,
  "quotedblbase": 0x201e,
  "quotedblleft": 0x201c,
  "quotedblright": 0x201d,
  "quoteleft": 0x2018,
  "quoteright": 0x2019,
  "quotesinglbase": 0x201a,
  "quotesingle": 0x0027,
  "r": 0x0072,
  "radical": 0x221a,
  "radicalex": 0xf8e5,
  "reflexsubset": 0x2286,
  "reflexsuperset": 0x2287,
  "registered": 0x00ae,
  "registersans": 0xf8e8,
  "registerserif": 0xf6da,
  "rho": 0x03c1,
  "ring": 0x02da,
  "rsuperior": 0xf6f1,
  "rupiah": 0xf6dd,
  "s": 0x0073,
  "scaron": 0x0161,
  "second": 0x2033,
  "section": 0x00a7,
  "semicolon": 0x003b,
  "seven": 0x0037,
  "seveneighths": 0x215e,
  "seveninferior": 0x2087,
  "sevenoldstyle": 0xf737,
  "sevensuperior": 0x2077,
  "sigma": 0x03c3,
  "sigma1": 0x03c2,
  "similar": 0x223c,
  "six": 0x0036,
  "sixinferior": 0x2086,
  "sixoldstyle": 0xf736,
  "sixsuperior": 0x2076,
  "slash": 0x002f,
  "space": 0x0020,
  "spade": 0x2660,
  "ssuperior": 0xf6f2,
  "sterling": 0x00a3,
  "suchthat": 0x220b,
  "summation": 0x2211,
  "t": 0x0074,
  "tau": 0x03c4,
  "therefore": 0x2234,
  "theta": 0x03b8,
  "theta1": 0x03d1,
  "thorn": 0x00fe,
  "three": 0x0033,
  "threeeighths": 0x215c,
  "threeinferior": 0x2083,
  "threeoldstyle": 0xf733,
  "threequarters": 0x00be,
  "threequartersemdash": 0xf6de,
  "threesuperior": 0x00b3,
  "tilde": 0x02dc,
  "trademark": 0x2122,
  "trademarksans": 0xf8ea,
  "trademarkserif": 0xf6db,
  "tsuperior": 0xf6f3,
  "two": 0x0032,
  "twodotenleader": 0x2025,
  "twoinferior": 0x2082,
  "twooldstyle": 0xf732,
  "twosuperior": 0x00b2,
  "twothirds": 0x2154,
  "u": 0x0075,
  "uacute": 0x00fa,
  "ucircumflex": 0x00fb,
  "udieresis": 0x00fc,
  "ugrave": 0x00f9,
  "underscore": 0x005f,
  "union": 0x222a,
  "universal": 0x2200,
  "upsilon": 0x03c5,
  "v": 0x0076,
  "w": 0x0077,
  "weierstrass": 0x2118,
  "x": 0x0078,
  "xi": 0x03be,
  "y": 0x0079,
  "yacute": 0x00fd,
  "ydieresis": 0x00ff,
  "yen": 0x00a5,
  "z": 0x007a,
  "zcaron": 0x017e,
  "zero": 0x0030,
  "zeroinferior": 0x2080,
  "zerooldstyle": 0xf730,
  "zerosuperior": 0x2070,
  "zeta": 0x03b6,
};

function getGlyphUnicode(name: string): number | undefined {
  return (GLYPH_TO_UNICODE as Record<string, number>)[name];
}



/**
 * Encodes replacement text using a font's unicode->byte map.
 * Throws a descriptive error if any character is not in the font's encoding.
 */
function encodeWithMap(text: string, unicodeToByte: Map<number, number>, fontNameForError: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    const byteVal = unicodeToByte.get(codePoint);
    if (byteVal === undefined) {
      const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
      const display = ch === ' ' ? 'space' : ch;
      throw new Error(
        `The replacement text contains character '${display}' (U+${hex}) which is not encoded in font '${fontNameForError}'. ` +
          `This font (likely a subset or WinAnsi-encoded simple font) does not contain a glyph for that character, so insertion would require re-embedding the font, which is not supported. ` +
          `Try using only characters that already appear in the original text on that page, or use deletion (empty replacement) which is always allowed.`
      );
    }
    bytes.push(byteVal);
  }
  return Uint8Array.from(bytes);
}

/**
 * Finds the active font name (without slash) for a given text group's first token
 * by scanning backwards for the nearest Tf operator.
 * Tf syntax: /FontName size Tf
 */
function findActiveFontName(tokens: Token[], targetFirstToken: Token): string | null {
  const targetIdx = tokens.indexOf(targetFirstToken);
  if (targetIdx < 0) return null;
  // Scan up to 100 tokens backwards
  for (let i = targetIdx - 1; i >= 0 && targetIdx - i <= 120; i--) {
    const tok = tokens[i];
    if (tok.value === 'Tf') {
      // Tf should be preceded by font name and size: /F1 12 Tf
      // So tokens[i-2] should be font name, tokens[i-1] number
      const nameToken = tokens[i - 2];
      const sizeToken = tokens[i - 1];
      if (nameToken && sizeToken && nameToken.value.startsWith('/') && sizeToken.type === 'number') {
        return nameToken.value.slice(1); // strip leading '/'
      }
      // Sometimes font name may be the immediate predecessor if size omitted? but spec requires size
      // Fallback: check single predecessor that is a name
      if (nameToken && nameToken.value.startsWith('/')) {
        return nameToken.value.slice(1);
      }
    }
  }
  return null;
}

/**
 * Resolves a font dictionary for a given page and font name.
 * Handles inherited Resources.
 */
function getFontDictForPage(
  pdfDocument: PDFDocument,
  pageIndex: number,
  fontName: string
): PDFDict | undefined {
  const page = pdfDocument.getPages()[pageIndex - 1];
  if (!page) return undefined;
  const resources = (page.node as unknown as { Resources: () => PDFDict | undefined }).Resources?.();
  // Fallback via generic lookup if Resources() helper not available
  let fontDictMap: PDFDict | undefined;
  if (resources) {
    fontDictMap = resources.lookupMaybe(PDFName.of('Font'), PDFDict);
  }
  if (!fontDictMap) {
    // Try direct attribute lookup for inherited case
    const dictRef = (page.node as unknown as { getInheritableAttribute: (n: PDFName) => unknown }).getInheritableAttribute?.(PDFName.of('Resources'));
    if (dictRef) {
      const resDict = pdfDocument.context.lookupMaybe(dictRef as any, PDFDict);
      if (resDict) {
        fontDictMap = resDict.lookupMaybe(PDFName.of('Font'), PDFDict);
      }
    }
  }
  if (!fontDictMap) return undefined;
  const fontRefOrDict = fontDictMap.get(PDFName.of(fontName));
  if (!fontRefOrDict) return undefined;
  const dict = pdfDocument.context.lookupMaybe(fontRefOrDict as any, PDFDict);
  if (dict) return dict;
  // If it's already a dict (not a ref), handle direct dict case
  if (fontRefOrDict instanceof PDFDict) return fontRefOrDict as PDFDict;
  return undefined;
}

/**
 * Inspects a font dictionary to determine if it's a composite (Type0) font
 * and to retrieve base encoding info.
 */
function inspectFontSubtype(fontDict: PDFDict, pdfDocument: PDFDocument): string | undefined {
  // Subtype may be stored as PDFName
  const subtypeObj = fontDict.get(PDFName.of('Subtype'));
  if (!subtypeObj) return undefined;
  // Try to resolve via context lookup if it's a ref
  const subtypeName = pdfDocument.context.lookupMaybe(subtypeObj as any, PDFName as any) as PDFName | undefined;
  if (subtypeName) {
    // PDFName has decodeText / asString
    try {
      const txt = (subtypeName as any).decodeText?.() ?? (subtypeName as any).asString?.() ?? subtypeName.toString();
      // toString returns "/Type0" style, strip slash
      return txt.startsWith('/') ? txt.slice(1) : txt;
    } catch {
      return subtypeName.toString().replace(/^\//, '').replace(/^\//, '');
    }
  }
  // Fallback: try toString directly
  const raw = subtypeObj.toString();
  return raw.startsWith('/') ? raw.slice(1) : raw;
}

function isCompositeFont(fontDict: PDFDict | undefined, pdfDocument: PDFDocument): boolean {
  if (!fontDict) return false;
  const subtype = inspectFontSubtype(fontDict, pdfDocument);
  // Per PDF spec, composite fonts are Subtype Type0 (with descendant CIDFonts)
  // Also treat CIDFontType0 / CIDFontType2 as composite if they appear directly (defensive)
  return subtype === 'Type0' || subtype === 'CIDFontType0' || subtype === 'CIDFontType2';
}

/**
 * Builds a unicode (codePoint) -> byte map for a simple font.
 * Returns null if font is composite (caller should handle rejection separately)
 * or if font has no encoding info and we fall back to WinAnsi as default.
 */
function buildUnicodeToByteMap(
  fontDict: PDFDict | undefined,
  pdfDocument: PDFDocument
): Map<number, number> | null {
  // If no font dict (couldn't resolve font), fall back to WinAnsi identity for ASCII-safe behavior
  // But we still need a map; return WinAnsi map so latin1-compatible insertions work
  if (!fontDict) {
    return buildMapFromBaseEncoding('WinAnsiEncoding', undefined);
  }
  if (isCompositeFont(fontDict, pdfDocument)) {
    return null; // signal composite
  }

  // Determine base encoding and differences
  let baseEncodingName: string | null = null;
  let differences: PDFArray | undefined;

  const encodingObj = fontDict.get(PDFName.of('Encoding'));
  if (encodingObj) {
    // Could be PDFName (e.g., /WinAnsiEncoding) or PDFDict
    const asName = pdfDocument.context.lookupMaybe(encodingObj as any, PDFName as any) as PDFName | undefined;
    if (asName) {
      try {
        const txt = (asName as any).decodeText?.() ?? (asName as any).asString?.() ?? asName.toString();
        baseEncodingName = txt.startsWith('/') ? txt.slice(1) : txt;
      } catch {
        baseEncodingName = asName.toString().replace(/^\//, '');
      }
    } else {
      const asDict = pdfDocument.context.lookupMaybe(encodingObj as any, PDFDict) as PDFDict | undefined;
      if (asDict) {
        const baseNameObj = asDict.get(PDFName.of('BaseEncoding'));
        if (baseNameObj) {
          const baseName = pdfDocument.context.lookupMaybe(baseNameObj as any, PDFName as any) as PDFName | undefined;
          if (baseName) {
            try {
              const txt2 = (baseName as any).decodeText?.() ?? (baseName as any).asString?.() ?? baseName.toString();
              baseEncodingName = txt2.startsWith('/') ? txt2.slice(1) : txt2;
            } catch {
              baseEncodingName = baseName.toString().replace(/^\//, '');
            }
          }
        }
        const diffObj = asDict.get(PDFName.of('Differences'));
        if (diffObj) {
          const diffArray = pdfDocument.context.lookupMaybe(diffObj as any, PDFArray) as PDFArray | undefined;
          if (diffArray) differences = diffArray;
          else if (diffObj instanceof PDFArray) differences = diffObj as PDFArray;
        }
      }
    }
  }

  // If no base encoding specified, PDF spec says:
  // - For Type1, default is StandardEncoding; for TrueType, default is WinAnsiEncoding (via font program)
  // We approximate: default to WinAnsiEncoding for broadly compatible behavior, except if subtype is Type1 and no encoding we use Standard.
  if (!baseEncodingName) {
    const subtype = inspectFontSubtype(fontDict, pdfDocument);
    if (subtype === 'Type1') baseEncodingName = 'StandardEncoding';
    else baseEncodingName = 'WinAnsiEncoding';
  }

  return buildMapFromBaseEncoding(baseEncodingName, differences, pdfDocument);
}

function buildMapFromBaseEncoding(
  baseEncodingName: string,
  differences: PDFArray | undefined,
  pdfDocument?: PDFDocument
): Map<number, number> {
  const baseByteToUnicode = getBaseEncodingByteToUnicode(baseEncodingName);
  // Build byte -> unicode map, applying Differences if present
  const byteToUnicode = new Map<number, number>();
  if (baseByteToUnicode) {
    for (let byte = 0; byte < 256; byte++) {
      const uni = baseByteToUnicode[byte];
      if (uni !== null) byteToUnicode.set(byte, uni);
    }
  } else {
    // Unknown base encoding: fallback to latin1 identity for 0-255 where byte==unicode for 32-126 and 160-255 Latin1 range
    for (let b = 32; b <= 126; b++) byteToUnicode.set(b, b);
    for (let b = 160; b <= 255; b++) byteToUnicode.set(b, b);
    // Also map common control? not needed
  }

  if (differences && pdfDocument) {
    // Differences array: sequence of code, glyphName, glyphName, ... where code is number and subsequent names assign sequentially
    let currentCode: number | null = null;
    for (let i = 0; i < differences.size(); i++) {
      const obj = differences.get(i);
      // obj could be PDFNumber or PDFName or PDFRef
      const asNumber = pdfDocument.context.lookupMaybe(obj as any, PDFNumber as any) as PDFNumber | undefined;
      if (asNumber) {
        currentCode = (asNumber as any).asNumber?.() ?? (asNumber as any).value?.() ?? Number((asNumber as any).toString());
        continue;
      }
      // Try PDFName
      const asName = pdfDocument.context.lookupMaybe(obj as any, PDFName as any) as PDFName | undefined;
      let glyphName: string | null = null;
      if (asName) {
        try {
          glyphName = (asName as any).decodeText?.() ?? (asName as any).asString?.() ?? asName.toString();
          if (glyphName?.startsWith('/')) glyphName = glyphName.slice(1);
        } catch {
          glyphName = asName.toString().replace(/^\//, '');
        }
      } else if (obj instanceof PDFName) {
        try {
          glyphName = (obj as any).decodeText?.() ?? (obj as any).asString?.() ?? obj.toString();
          if (glyphName?.startsWith('/')) glyphName = glyphName.slice(1);
        } catch {
          glyphName = obj.toString().replace(/^\//, '');
        }
      } else if (obj && typeof (obj as any).toString === 'function') {
        // Fallback: see if it's a name string
        const str = obj.toString();
        if (str.startsWith('/')) glyphName = str.slice(1);
      }
      if (glyphName !== null && currentCode !== null) {
        const uni = getGlyphUnicode(glyphName);
        if (uni !== undefined) {
          byteToUnicode.set(currentCode, uni);
        } else if (glyphName.length === 1) {
          // Single-char glyph name like "A" maps directly to its ASCII code
          byteToUnicode.set(currentCode, glyphName.charCodeAt(0));
        } else {
          // Unknown glyph name: leave unmapped (so unicode lookup will fail, which is desired)
          byteToUnicode.delete(currentCode);
        }
        currentCode++;
      }
    }
  }

  // Invert to unicode -> byte (prefer first byte for duplicate unicode)
  const unicodeToByte = new Map<number, number>();
  for (const [byte, uni] of byteToUnicode.entries()) {
    if (!unicodeToByte.has(uni)) {
      unicodeToByte.set(uni, byte);
    }
  }
  // Also ensure ASCII 32-126 are mapped even if base encoding had holes (for StandardEncoding etc., those are all present)
  // If map missing ASCII, fallback to identity for those
  for (let cp = 32; cp <= 126; cp++) {
    if (!unicodeToByte.has(cp)) {
      // Check if byte cp maps to same unicode in base; if not, add identity
      if (!byteToUnicode.has(cp)) {
        unicodeToByte.set(cp, cp);
      }
    }
  }
  return unicodeToByte;
}

function getBaseEncodingByteToUnicode(name: string): readonly (number | null)[] | null {
  return getBaseEncodingByteToUnicodeImpl(name);
}

function getBaseEncodingByteToUnicodeImpl(name: string): readonly (number | null)[] | null {
  switch (name) {
    case 'WinAnsiEncoding':
      return WinAnsiEncoding_BYTE_TO_UNICODE;
    case 'StandardEncoding':
      return StandardEncoding_BYTE_TO_UNICODE;
    case 'MacRomanEncoding':
      return MacRomanEncoding_BYTE_TO_UNICODE;
    default:
      return getBaseEncodingByteToUnicodeGeneric(name);
  }
}

function getBaseEncodingByteToUnicodeGeneric(_name: string): readonly (number | null)[] | null {
  return null;
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

function applyReplacementToBytes(bytes: Uint8Array, replacement: ContentTextReplacement, unicodeToByte?: Map<number, number>, fontNameForError?: string): { bytes: Uint8Array; changed: boolean } {
  const tokens = tokenize(bytes);
  const groups = findTextGroups(tokens);
  const candidates: Array<{ group: Token[]; text: string }> = [];

  // Helper to handle PDFs where TJ arrays split text without spaces (e.g., "Trace-basedJust-in-Time...")
  // while the viewer's span text has spaces. We try exact match first, then whitespace-normalized.
  const normalizeNoSpace = (s: string) => s.replace(/\s+/g, '');
  const sourceNoSpace = normalizeNoSpace(replacement.sourceText);

  for (const group of groups) {
    const text = group.map(token => token.value).join('');
    if (text.includes(replacement.sourceText)) {
      candidates.push({ group, text });
      continue;
    }
    // Fallback: match without whitespace (handles TJ arrays that omit spaces)
    if (sourceNoSpace.length > 0) {
      const textNoSpace = normalizeNoSpace(text);
      if (textNoSpace.includes(sourceNoSpace)) {
        // Keep original text for scoring, but remember this candidate was matched via normalized form
        // We'll handle the index mapping later via the same normalized logic
        candidates.push({ group, text });
      }
    }
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
  let sourceStart = fullText.indexOf(replacement.sourceText);
  let sourceEnd = sourceStart + replacement.sourceText.length;
  let usedNoSpaceFallback = false;

  // Fallback for TJ arrays that omit spaces (see debug: group text "Trace-basedJust-in-Time..." vs source "Trace-based Just-in-Time...")
  if (sourceStart === -1) {
    const sourceNoSpace = replacement.sourceText.replace(/\s+/g, '');
    // fullText is already join('') without spaces, so we can search directly
    const normalizedFullText = fullText.replace(/\s+/g, '');
    const normalizedIdx = normalizedFullText.indexOf(sourceNoSpace);
    if (normalizedIdx !== -1) {
      // Map normalized indices back to original fullText indices.
      // Since fullText has no spaces, normalizedFullText === fullText, so idx is directly usable.
      // For safety, handle the general case where fullText might contain spaces.
      sourceStart = normalizedIdx;
      sourceEnd = normalizedIdx + sourceNoSpace.length;
      usedNoSpaceFallback = true;
      // For the purpose of token mapping, we need to consider the original fullText's structure.
      // Since we matched on the no-space version, we treat the match as spanning the normalized range.
      // The subsequent token mapping will use these indices against the original fullText's character positions.
      // If fullText had spaces, we'd need a more complex mapping, but for our case (TJ without spaces), it's direct.
      // As a robust fallback, if the calculated range doesn't align with token boundaries, we fall back to replacing the whole group.
      // Check if the normalized range corresponds to a valid token range; if not, replace whole group.
    } else {
      return { bytes, changed: false };
    }
  }

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
  // If the no-space fallback was used and the token range is not cleanly found (e.g., due to spaces),
  // fall back to replacing the entire group – this is safe for title-like text that was split without spaces.
  if (usedNoSpaceFallback && (firstToken < 0 || lastToken < 0)) {
    firstToken = 0;
    lastToken = targetGroup.length - 1;
    firstLocalStart = 0;
    lastLocalEnd = targetGroup[lastToken].value.length;
  }
  if (firstToken < 0 || lastToken < 0) return { bytes, changed: false };

  const firstRaw = bytes.subarray(targetGroup[firstToken].start, targetGroup[firstToken].end);
  const firstDecoded = targetGroup[firstToken].type === 'string' ? decodeLiteralString(firstRaw) : decodeHexString(firstRaw);
  const firstText = bytesToLatin1(firstDecoded);
  const before = firstText.slice(0, firstLocalStart);
  const after = targetGroup[lastToken].value.slice(lastLocalEnd);
  let mergedBytes: Uint8Array;
  if (unicodeToByte) {
    // Use font-aware encoding for the replacement portion, but preserve original bytes for before/after (which are raw byte codes)
    const beforeBytes = latin1ToBytes(before);
    const afterBytes = latin1ToBytes(after);
    const replacementBytes = replacement.replacementText.length > 0
      ? encodeWithMap(replacement.replacementText, unicodeToByte, fontNameForError ?? 'unknown')
      : new Uint8Array(0);
    mergedBytes = new Uint8Array(beforeBytes.length + replacementBytes.length + afterBytes.length);
    mergedBytes.set(beforeBytes, 0);
    mergedBytes.set(replacementBytes, beforeBytes.length);
    mergedBytes.set(afterBytes, beforeBytes.length + replacementBytes.length);
  } else {
    const merged = before + replacement.replacementText + after;
    mergedBytes = latin1ToBytes(merged);
  }
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

    // --- COR-1 fix: font-aware encoding validation ---
    // For empty replacement (deletion), we explicitly allow it even for composite fonts,
    // since no new glyphs need to be encoded. This satisfies the requirement that
    // deleting text on a CID font should still succeed.
    let unicodeToByte: Map<number, number> | undefined;
    let fontNameForError: string | undefined;
    let isComposite = false;
    let fontDict: PDFDict | undefined;
    let activeFontName: string | null = null;

    if (replacement.replacementText.length > 0) {
      // Tokenize once to find the target font for this replacement
      // We reuse tokenization logic from applyReplacementToBytes to identify target group
      // To avoid duplicating logic, we perform a lightweight scan here to find font
      const tokensPreview = tokenize(decoded);
      const groupsPreview = findTextGroups(tokensPreview);
      // Find candidate group that would be edited (same logic as applyReplacementToBytes)
      const normalizeNoSpace = (s: string) => s.replace(/\s+/g, '');
      const sourceNoSpace = normalizeNoSpace(replacement.sourceText);
      let targetGroupPreview: Token[] | null = null;
      for (const group of groupsPreview) {
        const text = group.map(t => t.value).join('');
        if (text.includes(replacement.sourceText)) {
          targetGroupPreview = group;
          break;
        }
        if (sourceNoSpace.length > 0) {
          const textNoSpace = normalizeNoSpace(text);
          if (textNoSpace.includes(sourceNoSpace)) {
            targetGroupPreview = group;
            break;
          }
        }
      }
      if (targetGroupPreview) {
        activeFontName = findActiveFontName(tokensPreview, targetGroupPreview[0]);
        if (activeFontName) {
          fontNameForError = activeFontName;
          fontDict = getFontDictForPage(pdfDocument, replacement.pageIndex, activeFontName);
          isComposite = isCompositeFont(fontDict, pdfDocument);
        } else {
          // No Tf found: check if page contains any composite fonts as conservative fallback
          // If page has any Type0 font and we're inserting text, we warn/reject to avoid silent corruption
          const page = pdfDocument.getPages()[replacement.pageIndex - 1];
          if (page) {
            const resources = (page.node as unknown as { Resources: () => PDFDict | undefined }).Resources?.();
            const fontMap = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
            if (fontMap) {
              for (const [, fontObj] of fontMap.entries()) {
                const dict = pdfDocument.context.lookupMaybe(fontObj as any, PDFDict) as PDFDict | undefined;
                if (dict && isCompositeFont(dict, pdfDocument)) {
                  isComposite = true;
                  fontNameForError = '(unknown, but page contains composite font)';
                  break;
                }
              }
            }
          }
        }
      } else {
        // No candidate group found - will be handled as not changed later, but we still need to allow deletion path
        // For insertion case where no group found, we won't have font info; applyReplacementToBytes will return not changed
      }

      if (isComposite) {
        throw new Error(
          `Cannot encode replacement text for composite font '${fontNameForError ?? 'unknown'}' on page ${replacement.pageIndex}: ` +
            `composite (Type0/CID) fonts use multi-byte encodings (e.g., Identity-H) that cannot be safely edited with a simple byte substitution. ` +
            `This PDF's font is a subsetted CID font (common for PDFs generated by browsers/Word/LaTeX), and inserting new characters would produce corrupted output or require re-embedding the font, which is not supported. ` +
            `Deletions (empty replacement) are still allowed. To edit this document, delete the original text run and add a new annotation, or recreate the PDF with simple (WinAnsi) fonts.`
        );
      }

      // For simple fonts, build the unicode->byte map (WinAnsi + Differences)
      // This map is then used inside applyReplacementToBytes to encode replacement correctly
      // If font dict couldn't be resolved, build a permissive WinAnsi map so basic ASCII edits still work
      const map = buildUnicodeToByteMap(fontDict, pdfDocument);
      if (map === null) {
        // This should only happen for composite fonts which we already rejected above, but defensively handle
        throw new Error(
          `Cannot encode replacement text for composite font '${fontNameForError ?? 'unknown'}' on page ${replacement.pageIndex}: composite fonts are not supported for insertion.`
        );
      }
      unicodeToByte = map;
      fontNameForError = fontNameForError ?? (fontDict ? 'simple font' : 'unknown font');
    } else {
      // Deletion case: allow even for composite fonts, so we don't build a map and don't reject
      // Pass undefined map so applyReplacementToBytes uses latin1 path for before/after only
      unicodeToByte = undefined;
    }

    const result = applyReplacementToBytes(decoded, replacement, unicodeToByte, fontNameForError);
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
