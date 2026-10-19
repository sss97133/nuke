import React, { useEffect } from 'react';
import { Text } from '../../kit';
import './jobs.css';

/**
 * One Sign, as a sheet: what is being signed, the fields it needs, what signing says and what it
 * does not say, and one confirm button. The writer runs only from that button.
 */
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <div className="jb-sheet-backdrop" onClick={onClose}>
    <div className="jb-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className="jb-sheet__head">
        <Text role="entity" dense as="h2">{title}</Text>
        <button type="button" className="btn-base btn-xs btn-ghost" onClick={onClose}><Text role="label">{done ? 'Done' : 'Cancel'}</Text></button>
      </div>
      <div className="jb-sheet__body">
        {children}
        {done ? done : <>
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
        {failure && <Text role="body" className="jb-warn" aria-label="Refusal">{failure}</Text>}
      </div>
    </div>
  </div>;
}
