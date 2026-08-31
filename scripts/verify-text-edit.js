const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PDFDocument } = require('pdf-lib');
const { applyTextEditsToPDF } = require('../dist/shared/text-editor');

async function main() {
  const inputPath = process.argv[2] || path.resolve(__dirname, '../../edited.pdf');
  const input = new Uint8Array(fs.readFileSync(inputPath));
  const outputPath = path.resolve(process.cwd(), 'text-edit-verification.pdf');

  const sourceDocument = await PDFDocument.load(input);
  const output = await applyTextEditsToPDF(input, [{
    id: 'verify-languages-delete',
    pageIndex: 1,
    sourceText: 'Languages',
    text: '',
    x: 264,
    y: 681,
    width: 80,
    height: 18,
  }]);
  fs.writeFileSync(outputPath, output);

  // Confirm that the exported document is still structurally readable.
  const exportedDocument = await PDFDocument.load(output);
  if (exportedDocument.getPageCount() !== sourceDocument.getPageCount()) {
    throw new Error('Page count changed during text edit export.');
  }

  const text = execFileSync('pdftotext', [outputPath, '-'], { encoding: 'utf8' });
  if (/\bLanguages\b/.test(text)) {
    throw new Error('The original text is still present after deletion.');
  }

  console.log(`PASS: deleted "Languages" from page 1 and verified the exported PDF.\n${outputPath}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
