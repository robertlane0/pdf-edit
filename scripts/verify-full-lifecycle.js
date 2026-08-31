// scripts/verify-full-lifecycle.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { registerViewerScheme, registerViewerProtocol } = require('../dist/main/protocol');

app.commandLine.appendSwitch('enable-features', 'BlinkExtension');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');

registerViewerScheme();

async function runFullTest() {
  const pdfSession = session.fromPartition('persist:pdf-session');
  registerViewerProtocol();
  registerViewerProtocol(pdfSession);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      session: pdfSession,
      preload: path.join(__dirname, '../dist/preload/viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer Console] ${message}`);
  });

  win.webContents.on('did-finish-load', async () => {
    console.log('✅ Base page loaded');

    try {
      // 1. Wait for PDFViewerApplication to load the default sample document
      const testResult = await win.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          let renderedCount = 0;
          let annotationSuccess = false;

          window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'PDF_PAGE_RENDERED') {
              renderedCount++;
              console.log('[Test] PDF_PAGE_RENDERED received for page ' + event.data.payload.pageNumber + ' (scale: ' + event.data.payload.scale + ')');
              
              if (event.data.payload.pageNumber === 1 && !annotationSuccess) {
                // Test adding an annotation
                try {
                  window.__PDF_ADAPTER__.addAnnotation(1, {
                    id: 'test-annotation-1',
                    content: '<div class="test-ann" style="background:rgba(255,255,0,0.5);width:100px;height:50px;"></div>'
                  });

                  setTimeout(() => {
                    const layer = document.querySelector('.ext-overlay-layer');
                    const item = document.getElementById('test-annotation-1');
                    annotationSuccess = (layer !== null && item !== null);
                    console.log('[Test] Layer present: ' + (layer !== null) + ', Annotation item present: ' + (item !== null));
                    
                    resolve({
                      pagesRendered: renderedCount,
                      annotationSuccess: annotationSuccess,
                      scale: event.data.payload.scale
                    });
                  }, 200);
                } catch (e) {
                  reject(e);
                }
              }
            }
          });

          // Timeout fallback
          setTimeout(() => {
            resolve({
              timeout: true,
              pagesRendered: renderedCount,
              annotationSuccess: annotationSuccess
            });
          }, 8000);
        })
      `);

      console.log('Test Result:', JSON.stringify(testResult, null, 2));

      if (testResult.annotationSuccess && testResult.pagesRendered > 0) {
        console.log('✅ Full lifecycle test PASSED: Page rendering, event bridge, and DOM overlay injection verified!');
        app.quit();
        process.exit(0);
      } else {
        console.error('❌ Test failed or timed out:', testResult);
        app.quit();
        process.exit(1);
      }
    } catch (err) {
      console.error('❌ Execution error:', err);
      app.quit();
      process.exit(1);
    }
  });

  // Load sample document bundled with PDF.js generic viewer
  await win.loadURL('app-viewer://web/viewer.html?file=compressed.tracemonkey-pldi-09.pdf');
}

app.whenReady().then(runFullTest);
