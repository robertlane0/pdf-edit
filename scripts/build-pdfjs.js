// scripts/build-pdfjs.js
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

const SUBMODULE_DIR = path.join(__dirname, '../vendor/pdf.js');
const OUTPUT_DIR = path.join(__dirname, '../dist/pdfjs');

console.log('[Build] Building PDF.js submodule...');
execSync('npm ci && npx gulp generic', { cwd: SUBMODULE_DIR, stdio: 'inherit' });

fs.ensureDirSync(OUTPUT_DIR);
fs.copySync(path.join(SUBMODULE_DIR, 'build/generic'), OUTPUT_DIR);

console.log('[Build] Synced PDF.js assets to dist/pdfjs');
