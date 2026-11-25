import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import './profile-print.css';

/**
 * Document mode: the profile shown whole, so the browser can print it as the vehicle's document. Sections that slice,
 * collapse or read lazily on screen read this flag and open everything; nothing else changes. The printed page is the
 * profile itself, read from the same readers by the same viewer.
 */
let documentMode = false;
const listeners = new Set<() => void>();

export function setDocumentMode(on: boolean) {
  if (documentMode === on) return;
  documentMode = on;
  document.documentElement.classList.toggle('vp-document-mode', on);
  listeners.forEach(listener => listener());
}

export function useDocumentMode(): boolean {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => documentMode, () => false);
}

/** Resolves once no read is in flight and no section says it is still reading, for `quietTicks` checks in a row. */
export function settled(client: Pick<QueryClient, 'isFetching'>, root: ParentNode = document, { tick = 250, quietTicks = 4, limit = 90_000 } = {}): Promise<boolean> {
  return new Promise(resolve => {
    let quiet = 0;
    const started = Date.now();
    const check = () => {
      const busy = client.isFetching() > 0 || !!root.querySelector('[data-reading]');
      quiet = busy ? 0 : quiet + 1;
      if (quiet >= quietTicks) return resolve(true);
      if (Date.now() - started > limit) return resolve(false);
      setTimeout(check, tick);
    };
    setTimeout(check, tick);
  });
}

/** One button: open every section, wait for the readers, then hand the page to the browser's print dialog. */
export function PrintRecordButton() {
  const client = useQueryClient();
  const [state, setState] = useState<'idle' | 'preparing' | 'partial'>('idle');
  useEffect(() => {
    const done = () => { setDocumentMode(false); setState('idle'); };
    window.addEventListener('afterprint', done);
    return () => { window.removeEventListener('afterprint', done); setDocumentMode(false); };
  }, []);
  return <div className="vp-print-record">
    <button type="button" disabled={state === 'preparing'} onClick={async () => {
      setState('preparing');
      setDocumentMode(true);
      const complete = await settled(client);
      setState(complete ? 'idle' : 'partial');
      window.print();
    }}>{state === 'preparing' ? 'Reading every section…' : 'Print or save as PDF'}</button>
    {state === 'partial' && <p role="status">Some sections were still reading when the print opened.</p>}
  </div>;
}
