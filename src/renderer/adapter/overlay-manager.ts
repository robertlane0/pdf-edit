// src/renderer/adapter/overlay-manager.ts

/**
 * Dynamic SVG layer injection & virtualization manager.
 * Manages overlay layers on PDF.js page divs, handling the
 * re-injection needed when PDF.js virtualizes (unloads) pages.
 */

export interface OverlayEntry {
  id: string;
  pageNumber: number;
  svgContent: string;
}

/**
 * Manages overlay layers across all PDF pages, surviving
 * PDF.js page virtualization cycles.
 */
export class OverlayManager {
  /** In-memory store of all overlays, keyed by page number */
  private overlays = new Map<number, OverlayEntry[]>();

  /**
   * Add an overlay to a page. If the page is currently rendered,
   * immediately injects it into the DOM.
   */
  addOverlay(entry: OverlayEntry): void {
    if (!this.overlays.has(entry.pageNumber)) {
      this.overlays.set(entry.pageNumber, []);
    }
    this.overlays.get(entry.pageNumber)!.push(entry);
    this.injectToPage(entry.pageNumber);
  }

  /**
   * Remove an overlay by ID.
   */
  removeOverlay(id: string): void {
    for (const [pageNumber, entries] of this.overlays) {
      const idx = entries.findIndex(e => e.id === id);
      if (idx !== -1) {
        entries.splice(idx, 1);
        if (entries.length === 0) {
          this.overlays.delete(pageNumber);
        }
        this.injectToPage(pageNumber);
        return;
      }
    }
  }

  /**
   * Get all overlays for a specific page.
   */
  getOverlaysForPage(pageNumber: number): OverlayEntry[] {
    return this.overlays.get(pageNumber) ?? [];
  }

  /**
   * Called on `pagerendered` events to re-inject overlays
   * for a page that was virtualized and re-rendered.
   */
  onPageRendered(pageNumber: number): void {
    this.injectToPage(pageNumber);
  }

  /**
   * Clear all overlays for a specific page.
   */
  clearPage(pageNumber: number): void {
    this.overlays.delete(pageNumber);
    this.injectToPage(pageNumber);
  }

  /**
   * Clear all overlays across all pages.
   */
  clearAll(): void {
    this.overlays.clear();
  }

  /**
   * Inject stored overlays into the DOM for the given page.
   * Finds the page div via PDF.js DOM conventions.
   */
  private injectToPage(pageNumber: number): void {
    const pageDiv = document.querySelector(`[data-page-number="${pageNumber}"]`) as HTMLElement | null;
    if (!pageDiv) return;

    let layer = pageDiv.querySelector('.ext-overlay-layer') as HTMLElement | null;

    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'ext-overlay-layer';
      layer.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:10;';
      pageDiv.appendChild(layer);
    }

    // Clear and re-inject all overlays for this page
    layer.innerHTML = '';

    const entries = this.overlays.get(pageNumber) ?? [];
    for (const entry of entries) {
      const wrapper = document.createElement('div');
      wrapper.id = entry.id;
      wrapper.innerHTML = entry.svgContent;
      layer.appendChild(wrapper);
    }
  }
}
