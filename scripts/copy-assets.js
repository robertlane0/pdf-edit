const fs = require('fs-extra');
const path = require('path');

fs.ensureDirSync(path.join(__dirname, '../dist/assets/fonts'));
fs.copySync(
  path.join(__dirname, '../src/assets/fonts/LiberationSans-Regular.ttf'),
  path.join(__dirname, '../dist/assets/fonts/LiberationSans-Regular.ttf')
);

fs.ensureDirSync(path.join(__dirname, '../dist/pdfjs/web/images'));
fs.copySync(
  path.join(__dirname, '../src/assets/images/toolbarButton-fallbackFont.svg'),
  path.join(__dirname, '../dist/pdfjs/web/images/toolbarButton-fallbackFont.svg')
);

console.log('[Build] Copied assets');
