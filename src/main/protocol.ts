// src/main/protocol.ts
import { protocol, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import fs from 'fs';

const PDFJS_ROOT = path.normalize(path.join(__dirname, '../../dist/pdfjs'));

/**
 * Must be called BEFORE app.ready.
 * Registers 'app-viewer' as a privileged scheme so it behaves like https://
 * (standard fetch, service workers, CSP compliance, etc.)
 */
export function registerViewerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app-viewer',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: false,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

/**
 * Resolves an app-viewer:// URL to a filesystem path inside dist/pdfjs.
 * Handles relative path traversal where PDF.js uses '../build/' or '../web/'
 * from 'app-viewer://web/viewer.html'.
 */
export function resolveViewerPath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    let relativePath: string;

    if (url.hostname === 'web') {
      if (url.pathname.startsWith('/build/')) {
        // e.g. app-viewer://web/build/pdf.mjs -> build/pdf.mjs
        relativePath = url.pathname.slice(1);
      } else if (url.pathname.startsWith('/web/')) {
        // e.g. app-viewer://web/web/cmaps/ -> web/cmaps/
        relativePath = url.pathname.slice(1);
      } else {
        // e.g. app-viewer://web/viewer.html -> web/viewer.html
        relativePath = path.join('web', url.pathname);
      }
    } else {
      // e.g. app-viewer://pdfjs/web/viewer.html -> web/viewer.html
      relativePath = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    }

    relativePath = decodeURIComponent(relativePath);
    const safePath = path.normalize(path.join(PDFJS_ROOT, relativePath));

    // Security check: ensure path does not escape PDFJS_ROOT
    if (!safePath.startsWith(PDFJS_ROOT)) {
      return null;
    }

    return safePath;
  } catch {
    return null;
  }
}

/**
 * Must be called AFTER app.ready.
 * Handles app-viewer:// requests by serving files from dist/pdfjs/.
 *
 * @param ses - The Electron session to register the protocol on.
 *              If not provided, registers on the default session via protocol.handle.
 */
export function registerViewerProtocol(ses?: Electron.Session) {
  const handler = async (request: Request): Promise<Response> => {
    const safePath = resolveViewerPath(request.url);

    if (!safePath) {
      return new Response('Forbidden', { status: 403 });
    }

    // For viewer.html, ensure style-src permits inline styles needed by PDF.js text layer & overlay
    if (safePath.endsWith('.html')) {
      try {
        let content = await fs.promises.readFile(safePath, 'utf8');
        content = content.replace(
          /style-src 'self'/,
          "style-src 'self' 'unsafe-inline'"
        );
        return new Response(content, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8'
          }
        });
      } catch {
        // Fallback to net.fetch
      }
    }

    return net.fetch(pathToFileURL(safePath).toString());
  };

  if (ses) {
    ses.protocol.handle('app-viewer', handler);
  } else {
    protocol.handle('app-viewer', handler);
  }
}
