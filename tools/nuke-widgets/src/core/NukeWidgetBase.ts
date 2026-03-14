import { getSupabaseClient } from './supabase-client';
import { injectTheme, applyInheritTheme } from './theme';
import type { WidgetTheme, WidgetAccent } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Base class for all Nuke embeddable widgets.
 *
 * Handles:
 * - Shadow DOM creation + CSS isolation
 * - Auth (api-key attribute → X-API-Key header)
 * - Theming (light/dark/inherit + racing accents)
 * - Lifecycle management
 * - Event emission (composed CustomEvents that cross Shadow DOM)
 * - Shared Supabase client singleton
 */
/** Row in an inference popup */
export interface PopupRow {
  label: string;
  value: string;
  type?: 'text' | 'bar';
  pct?: number;
  cls?: string; // 'hot' | 'warm' | 'cool' | 'good'
}

export abstract class NukeWidgetBase extends HTMLElement {
  protected shadow: ShadowRoot;
  protected container: HTMLDivElement;
  protected supabase: SupabaseClient;
  protected apiKey: string | null = null;
  private _initialized = false;
  private _abortController: AbortController | null = null;
  private _popup: HTMLElement | null = null;
  private _popupDismiss: ((e: Event) => void) | null = null;

  /** Subclasses declare which attributes they observe (merged with base) */
  static get observedAttributes(): string[] {
    return ['api-key', 'user-token', 'theme', 'accent'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.container = document.createElement('div');
    this.container.className = 'nw-root';
    this.supabase = getSupabaseClient(null);
  }

  connectedCallback(): void {
    if (this._initialized) return;
    this._initialized = true;

    // Read attributes
    this.apiKey = this.getAttribute('api-key');
    this.supabase = getSupabaseClient(this.apiKey);

    // Inject theme CSS + widget-specific CSS
    injectTheme(this.shadow, this.widgetCSS());

    // Handle inherit theme
    if (this.getAttribute('theme') === 'inherit') {
      applyInheritTheme(this.shadow);
    }

    // Append container
    this.shadow.appendChild(this.container);

    // Show loading state
    this.container.innerHTML = '<div class="nw-loading"><span class="nw-loading-text">Loading</span></div>';

    // Create abort controller for fetch cleanup
    this._abortController = new AbortController();

    // Initialize widget
    this.init().catch(err => {
      this.showError(err.message || 'Failed to load widget');
    });
  }

  disconnectedCallback(): void {
    this._abortController?.abort();
    this.cleanup();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this._initialized) return;

    if (name === 'api-key') {
      this.apiKey = newValue;
      this.supabase = getSupabaseClient(this.apiKey);
      this.reload();
    } else if (name === 'theme' && newValue === 'inherit') {
      applyInheritTheme(this.shadow);
    }

    this.onAttributeChanged(name, oldValue, newValue);
  }

  // ─── Abstract methods (subclasses implement) ─────────────────────

  /** Widget-specific CSS to inject into Shadow DOM */
  protected abstract widgetCSS(): string;

  /** Initialize the widget (fetch data, render) */
  protected abstract init(): Promise<void>;

  /** Cleanup subscriptions, intervals, etc. */
  protected abstract cleanup(): void;

  // ─── Optional hooks ──────────────────────────────────────────────

  /** Called when any observed attribute changes (after base handling) */
  protected onAttributeChanged(_name: string, _oldValue: string | null, _newValue: string | null): void {}

  // ─── Shared utilities ────────────────────────────────────────────

  /** Get the abort signal for fetch requests (auto-cancelled on disconnect) */
  protected get signal(): AbortSignal {
    return this._abortController!.signal;
  }

  /** Emit a typed custom event that crosses Shadow DOM boundary */
  protected emit<T>(eventName: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(eventName, {
      detail,
      bubbles: true,
      composed: true,
    }));
  }

  /** Call a Nuke edge function (POST with JSON body) */
  protected async callFunction<T = unknown>(
    functionName: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    return this.callApi<T>(functionName, { method: 'POST', body });
  }

  /** Call a Nuke edge function with full control over method, path, and body */
  protected async callApi<T = unknown>(
    functionName: string,
    options?: { method?: string; path?: string; body?: Record<string, unknown> },
  ): Promise<T> {
    const method = options?.method ?? 'POST';
    const headers: Record<string, string> = {
      // Supabase gateway requires the anon key even for edge function calls
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk',
    };
    if (options?.body || method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    const userToken = this.getAttribute('user-token');
    if (userToken) {
      headers['Authorization'] = `Bearer ${userToken}`;
    }

    let url = `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/${functionName}`;
    if (options?.path) {
      url += `/${options.path}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: this.signal,
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || err.message || `API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Show an inference popup below the anchor element.
   * The popup is absolutely positioned within `posParent`.
   * Clicking outside or clicking the same anchor toggles it off.
   */
  protected showPopup(
    posParent: HTMLElement,
    anchor: HTMLElement,
    title: string,
    rows: PopupRow[],
    note?: string,
  ): void {
    // Toggle off if clicking the same anchor
    if (anchor.classList.contains('nw-inf--active')) {
      this.dismissPopup();
      return;
    }

    this.dismissPopup();

    const popup = document.createElement('div');
    popup.className = 'nw-popup';
    popup.style.top = `${anchor.offsetTop + anchor.offsetHeight}px`;

    let html = `<div class="nw-popup-head">${this.escapeHtml(title)}</div>`;
    for (const row of rows) {
      if (row.type === 'bar') {
        html += `<div class="nw-popup-bar">
          <span class="nw-popup-bar-lbl">${this.escapeHtml(row.label)}</span>
          <div class="nw-popup-bar-track"><div class="nw-popup-bar-fill" style="width:${row.pct ?? 0}%"></div></div>
          <span class="nw-popup-bar-val${row.cls ? ` nw-sig-${row.cls}` : ''}">${row.value}</span>
        </div>`;
      } else {
        html += `<div class="nw-popup-row">
          <span class="nw-popup-lbl">${this.escapeHtml(row.label)}</span>
          <span class="nw-popup-val${row.cls ? ` nw-sig-${row.cls}` : ''}">${row.value}</span>
        </div>`;
      }
    }
    if (note) {
      html += `<div class="nw-popup-note">${this.escapeHtml(note)}</div>`;
    }
    popup.innerHTML = html;

    posParent.style.position = 'relative';
    posParent.appendChild(popup);
    this._popup = popup;
    anchor.classList.add('nw-inf--active');

    // Dismiss on next click outside popup
    this._popupDismiss = (e: Event) => {
      if (!popup.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) {
        this.dismissPopup();
      }
    };
    requestAnimationFrame(() => {
      this.shadow.addEventListener('click', this._popupDismiss!);
    });
  }

  /** Dismiss the active inference popup */
  protected dismissPopup(): void {
    if (this._popup) {
      // Remove active state from anchor
      this._popup.parentElement?.querySelectorAll('.nw-inf--active').forEach(el => el.classList.remove('nw-inf--active'));
      this._popup.remove();
      this._popup = null;
    }
    if (this._popupDismiss) {
      this.shadow.removeEventListener('click', this._popupDismiss);
      this._popupDismiss = null;
    }
  }

  /**
   * Attach inference click handlers to all elements with `data-inf` attribute
   * within the given container. Calls `onInference(key, element)` when clicked.
   */
  protected attachInferenceHandlers(
    parent: HTMLElement,
    posParent: HTMLElement,
    handler: (key: string, el: HTMLElement) => void,
  ): void {
    parent.querySelectorAll('[data-inf]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        handler((el as HTMLElement).dataset.inf!, el as HTMLElement);
      });
    });
  }

  /** Show error state in the widget */
  protected showError(message: string): void {
    this.container.innerHTML = `<div class="nw-error">${this.escapeHtml(message)}</div>`;
  }

  /** Re-initialize the widget (e.g., after attribute change) */
  protected reload(): void {
    this._abortController?.abort();
    this._abortController = new AbortController();
    this.container.innerHTML = '<div class="nw-loading"><span class="nw-loading-text">Loading</span></div>';
    this.init().catch(err => {
      this.showError(err.message || 'Failed to load widget');
    });
  }

  /** Escape HTML to prevent XSS */
  protected escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /** Format currency */
  protected formatCurrency(value: number | null | undefined): string {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  /** Format number with commas */
  protected formatNumber(value: number | null | undefined): string {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-US').format(value);
  }

  /** Render the "Powered by Nuke" footer */
  protected poweredBy(): string {
    return '<div class="nw-powered">Powered by <a href="https://nuke.ag" target="_blank" rel="noopener">NUKE</a></div>';
  }
}
