/**
 * OfferComposer — the make-offer surface. Deliberately deep: it states plainly
 * that the offer is logged as testimony on the rig (not a private message), so
 * the act carries weight. A signature is pressed, never inferred.
 *
 * OfferComposerHost mounts once (in InteractionProvider) and listens for the
 * `nuke:make-offer` event that the peek-menu affordance dispatches — so
 * make-offer works from ANY vehicle's long-press menu, app-wide, not just the floor.
 */

import { useEffect, useState } from 'react';
import { makeOffer } from './offers';
import { haptic } from '../interaction/haptics';

export interface OfferTarget {
  vehicleId: string;
  ymm?: string;
  listingId?: string;
  askCents?: number;
}

export function OfferComposer({ target, onClose }: { target: OfferTarget; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    const cents = Math.round(parseFloat(amount.replace(/[^0-9.]/g, '')) * 100);
    setBusy(true);
    setError(null);
    const res = await makeOffer({
      vehicleId: target.vehicleId,
      amountCents: cents,
      note: note.trim() || undefined,
      listingId: target.listingId,
      ymm: target.ymm,
    });
    setBusy(false);
    if (res.ok) {
      haptic('confirm');
      setDone(true);
      setTimeout(onClose, 1100);
    } else {
      haptic('warn');
      setError(res.error || 'Could not send offer');
    }
  };

  const overAsk =
    target.askCents && amount
      ? Math.round(parseFloat(amount.replace(/[^0-9.]/g, '')) * 100) >= target.askCents
      : false;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onPointerDown={onClose}
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{ width: 360, maxWidth: '100%', background: 'var(--surface, #fff)', color: 'var(--text, #111)', border: '2px solid var(--text, #111)', fontFamily: 'Arial, sans-serif' }}
      >
        <div style={{ borderBottom: '2px solid var(--text, #111)', padding: '8px 10px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
          <span>Make offer{target.ymm ? ` · ${target.ymm}` : ''}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>

        {done ? (
          <div style={{ padding: 20, fontSize: 12 }}>
            Offer logged. It's now part of this vehicle's record.
          </div>
        ) : (
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7 }}>
              Your offer (USD)
              <input
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="12,500"
                style={{ width: '100%', marginTop: 4, padding: '8px', border: '2px solid var(--text, #111)', borderRadius: 0, fontFamily: 'inherit', fontSize: 16, background: 'transparent', color: 'inherit' }}
              />
            </label>
            {target.askCents ? (
              <div style={{ fontSize: 10, opacity: 0.7 }}>
                Ask ${(target.askCents / 100).toLocaleString()} · {overAsk ? 'at or over ask' : 'under ask'}
              </div>
            ) : null}
            <label style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.7 }}>
              Note (optional)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="terms, timing, contingencies"
                style={{ width: '100%', marginTop: 4, padding: '8px', border: '2px solid var(--text, #111)', borderRadius: 0, fontFamily: 'inherit', fontSize: 12, background: 'transparent', color: 'inherit' }}
              />
            </label>
            <div style={{ fontSize: 9, opacity: 0.55, lineHeight: 1.4 }}>
              Logged as testimony on this rig with your identity and timestamp. Offers accrue to the vehicle's demand record.
            </div>
            {error && <div style={{ fontSize: 11, color: 'var(--danger, #b00)' }}>{error}</div>}
            <button
              disabled={busy || !amount}
              onClick={submit}
              style={{ padding: '10px', border: '2px solid var(--text, #111)', borderRadius: 0, background: 'var(--text, #111)', color: 'var(--surface, #fff)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: busy || !amount ? 'default' : 'pointer', opacity: busy || !amount ? 0.5 : 1 }}
            >
              {busy ? 'Sending…' : 'Send offer'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Global host — mount once. Opens the composer on `nuke:make-offer`. */
export function OfferComposerHost() {
  const [target, setTarget] = useState<OfferTarget | null>(null);
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as OfferTarget;
      if (detail?.vehicleId) setTarget(detail);
    };
    window.addEventListener('nuke:make-offer', onEvent as EventListener);
    return () => window.removeEventListener('nuke:make-offer', onEvent as EventListener);
  }, []);
  if (!target) return null;
  return <OfferComposer target={target} onClose={() => setTarget(null)} />;
}
