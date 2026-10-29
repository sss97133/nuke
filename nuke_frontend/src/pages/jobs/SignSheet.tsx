import React, { useEffect, useId, useRef } from 'react';
import { Text } from '../../kit';
import './jobs.css';

/**
 * One Sign, as a sheet: what is being signed, the fields it needs, what signing says and what it
 * does not say, and one confirm button. The writer runs only from that button.
 */
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function SignSheet({ title, says, doesNotSay, confirmLabel, onConfirm, onClose, busy, failure, done, children }: {
  title: string;
  says: string[];
  doesNotSay: string[];
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  failure?: string | null;
  /** Replaces the confirm step once the server answered; any falsy value keeps the confirm step. */
  done?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  // Once submitted, dismissing the sheet cannot cancel the server operation.
  // Keep its eventual answer visible instead of implying that Cancel undid a Sign.
  closeRef.current = busy ? () => {} : onClose;
  const titleId = useId();

  // Focus moves into the sheet when it opens (its first field, else the sheet), stays inside while it is open (Tab and
  // Shift+Tab wrap), Escape closes it, and focus returns to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialog.current;
    const focusables = () => (root ? [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1) : []);
    const field = root?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])');
    (field ?? root)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !root) return;
      const list = focusables();
      if (list.length === 0) { e.preventDefault(); root.focus(); return; }
      const first = list[0], last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !root.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const close = () => { if (!busy) onClose(); };
  return <div className="jb-sheet-backdrop" onClick={close}>
    <div ref={dialog} tabIndex={-1} className="jb-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e => e.stopPropagation()}>
      <div className="jb-sheet__head">
        <Text role="entity" dense as="h2" id={titleId}>{title}</Text>
        <button type="button" className="btn-base btn-xs btn-ghost" disabled={busy} onClick={close}><Text role="label">{done ? 'Done' : 'Cancel'}</Text></button>
      </div>
      <div className="jb-sheet__body">
        {children}
        {done ? <div role="status">{done}</div> : <>
          <div className="jb-says">
            <Text role="label">Signing says</Text>
            <ul>{says.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul>
          </div>
          <div className="jb-says">
            <Text role="label">It does not say</Text>
            <ul>{doesNotSay.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul>
          </div>
          <div className="jb-actions">
            <button type="button" className="btn-base btn-md btn-primary" disabled={busy} onClick={onConfirm}>
              <Text role="label">{busy ? 'Sending…' : confirmLabel}</Text>
            </button>
          </div>
        </>}
        <div role="alert" className="jb-live">{failure && <Text role="body" className="jb-warn">{failure}</Text>}</div>
      </div>
    </div>
  </div>;
}
