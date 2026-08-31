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
 * Transforms modern CSS features (such as light-dark() from CSS Color Module Level 5)
 * into standard CSS compatible with Chromium <123.
 *
 * For light-dark(L, D), the light value L is used for the default ruleset,
 * and a corresponding @media (prefers-color-scheme: dark) override is appended.
 */
export function transformCssLightDark(cssContent: string): string {
  let lightCss = '';
  const darkRulesMap = new Map<string, Array<{ prop: string; darkVal: string }>>();

  let pos = 0;
  while (true) {
    const start = cssContent.indexOf('light-dark(', pos);
    if (start === -1) {
      lightCss += cssContent.slice(pos);
      break;
    }
    lightCss += cssContent.slice(pos, start);

    let depth = 1;
    let commaPos = -1;
    let endPos = -1;
    for (let i = start + 11; i < cssContent.length; i++) {
      const ch = cssContent[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          endPos = i;
          break;
        }
      } else if (ch === ',' && depth === 1 && commaPos === -1) {
        commaPos = i;
      }
    }

    if (endPos !== -1 && commaPos !== -1) {
      const light = cssContent.substring(start + 11, commaPos).trim();
      const dark = cssContent.substring(commaPos + 1, endPos).trim();

      // Find property name and selector
      const lastOpenBrace = cssContent.lastIndexOf('{', start);
      const prevCloseBrace = cssContent.lastIndexOf('}', lastOpenBrace);
      let selector = cssContent.substring(prevCloseBrace + 1, lastOpenBrace).trim();
      // Remove any comments in selector
      selector = selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();

      const lastColon = cssContent.lastIndexOf(':', start);
      const lastSemicolon = cssContent.lastIndexOf(';', lastColon);
      const propName = cssContent.substring(Math.max(lastSemicolon + 1, lastOpenBrace + 1), lastColon).trim();

      if (selector && propName) {
        if (!darkRulesMap.has(selector)) {
          darkRulesMap.set(selector, []);
        }
        darkRulesMap.get(selector)!.push({ prop: propName, darkVal: dark });
      }

      lightCss += light;
      pos = endPos + 1;
    } else {
      lightCss += cssContent.slice(start, start + 11);
      pos = start + 11;
    }
  }

  // Generate dark mode overrides
  if (darkRulesMap.size > 0) {
    let darkCss = '\n@media (prefers-color-scheme: dark) {\n';
    for (const [selector, decls] of darkRulesMap.entries()) {
      darkCss += `  ${selector} {\n`;
      for (const { prop, darkVal } of decls) {
        darkCss += `    ${prop}: ${darkVal};\n`;
      }
      darkCss += '  }\n';
    }
    darkCss += '}\n';
    return lightCss + darkCss;
  }

  return lightCss;
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

    // For .css files, transform modern CSS features (e.g. light-dark) for Chromium compatibility
    if (safePath.endsWith('.css')) {
      try {
        let content = await fs.promises.readFile(safePath, 'utf8');
        content = transformCssLightDark(content);
        return new Response(content, {
          headers: {
            'Content-Type': 'text/css; charset=utf-8'
          }
        });
      } catch {
        // Fallback to net.fetch
      }
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
