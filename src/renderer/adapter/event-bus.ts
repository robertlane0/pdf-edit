// src/renderer/adapter/event-bus.ts

/**
 * PDF.js EventBus listener maps.
 * Provides typed wrappers around the PDF.js internal EventBus
 * for consistent event subscription and cleanup.
 */

export type PDFEventType =
  | 'pagerendered'
  | 'pagechanging'
  | 'scalechanging'
  | 'documentloaded'
  | 'pagesloaded'
  | 'textlayerrendered'
  | 'annotationlayerrendered';

export interface PDFEventPayload {
  pagerendered: { pageNumber: number; cssTransform: boolean; timestamp: number };
  pagechanging: { pageNumber: number; previous: number };
  scalechanging: { scale: number; presetValue?: string };
  documentloaded: Record<string, never>;
  pagesloaded: { pagesCount: number };
  textlayerrendered: { pageNumber: number };
  annotationlayerrendered: { pageNumber: number };
}

type ListenerFn<T extends PDFEventType> = (payload: PDFEventPayload[T]) => void;

interface EventBusRef {
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
}

/**
 * Typed wrapper around the PDF.js EventBus for safe event subscription.
 */
export class PDFEventBusAdapter {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(private eventBus: EventBusRef) {}

  /**
   * Subscribe to a PDF.js event with type safety.
   */
  on<T extends PDFEventType>(event: T, callback: ListenerFn<T>): void {
    this.eventBus.on(event, callback as any);

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as any);
  }

  /**
   * Unsubscribe from a PDF.js event.
   */
  off<T extends PDFEventType>(event: T, callback: ListenerFn<T>): void {
    this.eventBus.off(event, callback as any);
    this.listeners.get(event)?.delete(callback as any);
  }

  /**
   * Remove all registered listeners (cleanup).
   */
  destroy(): void {
    for (const [event, callbacks] of this.listeners) {
      for (const cb of callbacks) {
        this.eventBus.off(event, cb);
      }
    }
    this.listeners.clear();
  }
}
