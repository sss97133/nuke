/**
 * HeaderSearchLauncher — the header's search box as a light placeholder until it is used.
 *
 * The real Magic Box (search/AIDataIngestionSearch, with its taxonomy tables, image ingestion and invoice uploader)
 * is about a quarter of the entry bundle, and every route paid for it before first paint. This draws the same box
 * from CSS, fetches the real one when the browser is idle or the pointer comes near, and swaps it in on focus,
 * typing, a drag or the actions button, carrying the focus and anything already typed into the real input.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './HeaderSearchLauncher.css';

type SearchComponent = React.ComponentType<{ className?: string }>;
let loading: Promise<SearchComponent> | null = null;
const loadSearch = () => (loading ??= import('./HeaderSearch').then(m => m.default as SearchComponent));

const PLACEHOLDER = 'SEARCH, PASTE URL, VIN, OR DROP IMAGE...';
const LABEL = 'Magic Box — search, URL, VIN, or image';
const PREFETCH_DELAY_MS = 2000;

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function HeaderSearchLauncher({ className }: { className?: string }) {
  const [Search, setSearch] = useState<SearchComponent | null>(null);
  const handoff = useRef({ text: '', focus: false });
  const box = useRef<HTMLDivElement>(null);

  const activate = useCallback((focus: boolean) => {
    handoff.current.focus = handoff.current.focus || focus;
    void loadSearch().then(C => setSearch(() => C));
  }, []);

  // Fetch the real box once the page has settled — after `load`, a short pause and an idle moment — so it never
  // competes with the route's own code on a slow connection, yet is usually ready before anyone reaches for it.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let timer = 0;
    let idle = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (w.requestIdleCallback) idle = w.requestIdleCallback(() => { void loadSearch(); }, { timeout: 5000 });
        else void loadSearch();
      }, PREFETCH_DELAY_MS);
    };
    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });
    return () => {
      window.removeEventListener('load', schedule);
      window.clearTimeout(timer);
      if (idle) w.cancelIdleCallback?.(idle);
    };
  }, []);

  // After the swap: move focus and any typed text into the real input.
  useEffect(() => {
    if (!Search) return;
    const input = box.current?.querySelector<HTMLInputElement>('input[type="text"]');
    if (!input) return;
    if (handoff.current.text) setReactInputValue(input, handoff.current.text);
    if (handoff.current.focus) input.focus();
  }, [Search]);

  if (Search) return <div ref={box} className="hsl-live"><Search className={className} /></div>;

  return <div ref={box} className="hsl-shell">
    <div className="hsl-box" onDragEnter={() => activate(false)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); activate(true); }}>
      <input type="text" className="hsl-input" placeholder={PLACEHOLDER} aria-label={LABEL}
        onPointerEnter={() => void loadSearch()} onFocus={() => activate(true)}
        onChange={e => { handoff.current.text = e.target.value; activate(true); }} />
      <button type="button" className="button-win95 hsl-more" title="Show actions" aria-label="Show actions" onClick={() => activate(true)}>...</button>
    </div>
  </div>;
}
