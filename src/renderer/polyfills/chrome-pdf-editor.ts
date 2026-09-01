// src/renderer/polyfills/chrome-pdf-editor.ts

export const chromePdfEditor = {
  onPageRendered: (callback: (data: { pageNumber: number; scale: number }) => void) => {
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'PDF_PAGE_RENDERED') {
        callback(event.data.payload);
      }
    });
  },

  addHighlight: (pageNumber: number, rect: { x: number; y: number; width: number; height: number; color: string }) => {
    const svgContent = `
      <svg style="position:absolute; width:100%; height:100%; top:0; left:0;">
        <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" 
              fill="${rect.color}" fill-opacity="0.4" />
      </svg>
    `;
    (window as any).__PDF_ADAPTER__.addAnnotation(pageNumber, {
      id: `highlight-${Date.now()}-${Math.random()}`,
      content: svgContent
    });
  },

  exportDocument: async (): Promise<Uint8Array> => {
    return await (window as any).__PDF_ADAPTER__.getPDFBytes();
  }
};
