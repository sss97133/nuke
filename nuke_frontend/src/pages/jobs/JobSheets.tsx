import React, { useState } from 'react';
import { Text } from '../../kit';
import { SignSheet } from './SignSheet';
import { JobSigns, PRICING_BASES, offerArgs, pricingUnit, yourRung, type JobAction, type OfferLineDraft } from './jobsReaders';

const OFFER_SAYS = ["You'll do this work at these prices, through Nuke."];
const OFFER_NOT = ['Nothing is booked until the customer accepts', 'No payment is made', 'Your contact details are not shared'];

/** A provider's offer on one request, sent only from the server's own `offer` action. */
export function OfferSheet({ action, requestTitle, onClose }: { action: JobAction; requestTitle: string; onClose: () => void }) {
  const [lines, setLines] = useState<OfferLineDraft[]>([{ description: requestTitle.slice(0, 300), pricing_basis: 'flat', amount: '', currency: 'USD', quantity: '' }]);
  const [useWindow, setUseWindow] = useState(false);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<{ duplicate: boolean } | null>(null);

  const update = (i: number, patch: Partial<OfferLineDraft>) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const send = async () => {
    setFailure(null);
    const built = offerArgs(action, lines, useWindow ? { from, until } : null, note);
    if ('error' in built) { setFailure(built.error); return; }
    setBusy(true);
    const r = await JobSigns.offer(built.args);
    setBusy(false);
    if (r.refusal) setFailure(`Not sent. ${r.refusal.message}`);
    else setSent({ duplicate: !!r.data?.duplicate });
  };

  return <SignSheet title="Make an offer" says={OFFER_SAYS} doesNotSay={OFFER_NOT} confirmLabel="Send offer" onConfirm={send} onClose={onClose}
    busy={busy} failure={failure}
    done={sent && <div className="jb-says">
      <Text role="body" className="jb-done">{sent.duplicate ? 'You already sent this offer.' : 'Offer sent.'}</Text>
      <Text role="body">The customer sees it on the job. Nothing is booked until they accept.</Text>
    </div>}>
    <div className="jb-field"><Text role="label">Request</Text><Text role="body">{requestTitle}</Text></div>
    <div className="jb-field"><Text role="label">Your offer shows as</Text><Text role="body">{yourRung(action.as?.offer_rung)}</Text></div>
    {!sent && <>
      {lines.map((l, i) => <div className="jb-line" key={i} role="group" aria-label={`Price line ${i + 1}`}>
        <label className="jb-field"><Text role="label">What you'll do</Text>
          <input className="jb-input k-body" value={l.description} maxLength={300} onChange={e => update(i, { description: e.target.value })} /></label>
        <div className="jb-field--row">
          <label className="jb-field"><Text role="label">Priced</Text>
            <select className="jb-input k-body" value={l.pricing_basis} onChange={e => update(i, { pricing_basis: e.target.value })}>
              {PRICING_BASES.map(b => <option key={b.key} value={b.key}>{b.title}</option>)}
            </select></label>
          <label className="jb-field"><Text role="label">Amount</Text>
            <input className="jb-input k-body" inputMode="decimal" value={l.amount} onChange={e => update(i, { amount: e.target.value })} /></label>
          <label className="jb-field"><Text role="label">Currency</Text>
            <input className="jb-input jb-input--short k-body" value={l.currency} maxLength={3} onChange={e => update(i, { currency: e.target.value })} /></label>
          {l.pricing_basis !== 'flat' && <label className="jb-field"><Text role="label">{`${pricingUnit(l.pricing_basis)}s (optional)`}</Text>
            <input className="jb-input jb-input--short k-body" inputMode="decimal" value={l.quantity} onChange={e => update(i, { quantity: e.target.value })} /></label>}
        </div>
      </div>)}
      {lines.length < 5 && <div><button type="button" className="btn-base btn-xs btn-secondary"
        onClick={() => setLines(ls => [...ls, { description: '', pricing_basis: 'flat', amount: '', currency: 'USD', quantity: '' }])}>
        <Text role="label">Add a line</Text></button></div>}
      <label className="jb-choice"><span><input type="checkbox" checked={useWindow} onChange={e => setUseWindow(e.target.checked)} /> <Text role="body">Set when you're available</Text></span></label>
      {useWindow && <div className="jb-field--row">
        <label className="jb-field"><Text role="label">From</Text><input type="date" className="jb-input k-body" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="jb-field"><Text role="label">Until</Text><input type="date" className="jb-input k-body" value={until} onChange={e => setUntil(e.target.value)} /></label>
      </div>}
      <label className="jb-field"><Text role="label">Note (one line, optional)</Text>
        <input className="jb-input k-body" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
    </>}
  </SignSheet>;
}

/** A contact request brokered by Nuke: no contact fields are shown or sent, only a message in the app. */
export function ContactSheet({ requirementId, contextLabel, onClose }: { requirementId: string; contextLabel: string; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    setFailure(null);
    const m = message.trim();
    if (m.length < 1 || m.length > 500) { setFailure('Write a message of 1 to 500 characters.'); return; }
    setBusy(true);
    const r = await JobSigns.contact(requirementId, m);
    setBusy(false);
    if (r.refusal) setFailure(`Not sent. ${r.refusal.message}`);
    else setSent(true);
  };

  return <SignSheet title="Contact via Nuke" says={['Your message reaches the people on this job inside Nuke.', 'They choose whether to open a thread with you.']}
    doesNotSay={['Your contact details, or theirs', 'Any offer, agreement or payment']} confirmLabel="Send request" onConfirm={send} onClose={onClose}
    busy={busy} failure={failure}
    done={sent && <Text role="body" className="jb-done">Request sent. It is delivered in the app; no contact details were shared.</Text>}>
    <div className="jb-field"><Text role="label">About</Text><Text role="body">{contextLabel}</Text></div>
    {!sent && <label className="jb-field"><Text role="label">Message</Text>
      <textarea className="jb-input k-body" value={message} maxLength={500} onChange={e => setMessage(e.target.value)} /></label>}
    {!sent && <Text role="caption">Up to 10 requests a day.</Text>}
  </SignSheet>;
}
