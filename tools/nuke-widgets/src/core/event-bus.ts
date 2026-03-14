type EventCallback = (data: unknown) => void;

/**
 * Cross-widget event bus using BroadcastChannel.
 * Widgets on the same page can coordinate via this bus.
 *
 * Example: map widget emits 'vehicle-selected', auction widget highlights it.
 */
class NukeEventBus {
  private channel: BroadcastChannel | null = null;
  private listeners = new Map<string, Set<EventCallback>>();

  private ensureChannel(): BroadcastChannel {
    if (!this.channel) {
      this.channel = new BroadcastChannel('nuke-widgets');
      this.channel.addEventListener('message', (e: MessageEvent) => {
        const { event, data } = e.data as { event: string; data: unknown };
        const callbacks = this.listeners.get(event);
        if (callbacks) {
          callbacks.forEach(cb => cb(data));
        }
      });
    }
    return this.channel;
  }

  /** Emit an event to all widgets on the page */
  emit(event: string, data: unknown): void {
    this.ensureChannel().postMessage({ event, data });
  }

  /** Listen for cross-widget events */
  on(event: string, callback: EventCallback): () => void {
    this.ensureChannel();
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /** Remove all listeners and close channel */
  destroy(): void {
    this.listeners.clear();
    this.channel?.close();
    this.channel = null;
  }
}

/** Singleton event bus shared by all widgets on the page */
export const nukeEventBus = new NukeEventBus();
