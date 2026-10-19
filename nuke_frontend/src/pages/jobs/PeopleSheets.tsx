import React, { useEffect, useState } from 'react';
import { Text } from '../../kit';
import { SignSheet } from './SignSheet';
import { day, obj, parseAction, personLabel, str, type JobAction, type JsonObject } from './jobRead';
import {
  COSIGN_KINDS, actingFor, confirmBookingArgs, cosignArgs, facilityAssets, facilityChoices, reserveArgs, vouchArgs,
  type Asset, type CutBasis,
} from './signDrafts';
import { readJob } from './readJob';
import { termsOf, useWriter } from './useWriter';

function KindPicker({ kinds, onChange }: { kinds: string[]; onChange: (k: string[]) => void }) {
  return <div className="jb-field" role="group" aria-label="Kinds">
    <Text role="label">What you vouch for</Text>
    {COSIGN_KINDS.map(k => <label key={k.key} className="jb-choice"><span>
      <input type="checkbox" checked={kinds.includes(k.key)} onChange={e => onChange(e.target.checked ? [...kinds, k.key] : kinds.filter(x => x !== k.key))} />{' '}
      <Text role="body">{`${k.title}: ${k.explain}`}</Text></span></label>)}
  </div>;
}

/** cosign_provider on one offer, offered by work_order_offers_read; the capacities come from the action's acting_for. */
export function CosignSheet({ action, offerWho, onClose, onDone }: { action: JobAction; offerWho: string; onClose: () => void; onDone: () => void }) {
  const capacities = actingFor(action);
  const [acting, setActing] = useState(0);
  const [kinds, setKinds] = useState<string[]>([]);
  const [scope, setScope] = useState('');
  const [basis, setBasis] = useState<CutBasis>('none');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('USD');
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);
  const send = async () => {
    const built = cosignArgs(action, kinds, scope, basis, value, currency, capacities[acting]?.cut ?? null);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('cosign_provider', built.args);
  };
  return <SignSheet title="Co-sign this technician" says={says} doesNotSay={doesNotSay} confirmLabel="Co-sign" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Co-signed. If the offer changes, the customer must accept it again.</Text>}>
    <div className="jb-field"><Text role="label">Offer from</Text><Text role="body">{offerWho}</Text></div>
    {!w.done && <>
      {capacities.length > 1 && <label className="jb-field"><Text role="label">Co-sign as</Text>
        <select className="jb-input k-body" aria-label="Co-sign as" value={acting} onChange={e => setActing(Number(e.target.value))}>
          {capacities.map((c, i) => <option key={i} value={i}>{c.title}</option>)}</select></label>}
      <KindPicker kinds={kinds} onChange={setKinds} />
      <label className="jb-field"><Text role="label">Scope: what exactly you stand behind</Text>
        <textarea className="jb-input k-body" aria-label="Scope" maxLength={2000} value={scope} onChange={e => setScope(e.target.value)} /></label>
      <div className="jb-field--row">
        <label className="jb-field"><Text role="label">Your cut (optional)</Text>
          <select className="jb-input k-body" aria-label="Cut" value={basis} onChange={e => setBasis(e.target.value as CutBasis)}>
            <option value="none">No cut</option><option value="share_of_labor_line">Share of labor (%)</option><option value="flat">Flat</option><option value="day_rate">Per day</option>
          </select></label>
        {basis !== 'none' && <label className="jb-field"><Text role="label">{basis === 'share_of_labor_line' ? 'Percent' : 'Amount'}</Text>
          <input className="jb-input jb-input--short k-body" aria-label="Cut value" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} /></label>}
        {(basis === 'flat' || basis === 'day_rate') && <label className="jb-field"><Text role="label">Currency</Text>
          <input className="jb-input jb-input--short k-body" aria-label="Cut currency" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value)} /></label>}
      </div>
      <Text role="caption">A cut binds only if the customer accepts this offer, and is never paid by Nuke.</Text>
    </>}
  </SignSheet>;
}

const VOUCH_ACTION: JobAction = parseAction({ action: 'vouch', rpc: 'vouch_for_provider' })!;

/** vouch_for_provider: a standing vouch with scope; the server decides who may vouch (a shop on Nuke or tools on record). */
export function VouchSheet({ subject, name, onClose, onDone }: { subject: { userId: string | null; actorId: string | null }; name: string; onClose: () => void; onDone: () => void }) {
  const [kinds, setKinds] = useState<string[]>([]);
  const [scope, setScope] = useState('');
  const [expires, setExpires] = useState('');
  const w = useWriter();
  const { says, doesNotSay } = termsOf(VOUCH_ACTION);
  const send = async () => {
    const built = vouchArgs(subject, kinds, scope, expires);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('vouch_for_provider', built.args);
  };
  return <SignSheet title={`Vouch for ${name}`} says={says} doesNotSay={doesNotSay} confirmLabel="Vouch" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Vouch recorded. It shows on their page under Vouched for by.</Text>}>
    {!w.done && <>
      <KindPicker kinds={kinds} onChange={setKinds} />
      <label className="jb-field"><Text role="label">Scope: what exactly you stand behind</Text>
        <textarea className="jb-input k-body" aria-label="Scope" maxLength={2000} value={scope} onChange={e => setScope(e.target.value)} /></label>
      <label className="jb-field"><Text role="label">Ends (optional)</Text>
        <input type="date" className="jb-input k-body" aria-label="Vouch ends" value={expires} onChange={e => setExpires(e.target.value)} /></label>
    </>}
  </SignSheet>;
}

/** reserve_facility: ask a shop the action names for one declared space in a window. Capacity is held only when the shop confirms. */
export function ReserveFacilitySheet({ action, onClose, onDone }: { action: JobAction; onClose: () => void; onDone: () => void }) {
  const shops = facilityChoices(action);
  const [shop, setShop] = useState(shops[0]?.organizationId ?? '');
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [assetsFailure, setAssetsFailure] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [fee, setFee] = useState<'none' | 'hourly' | 'day_rate'>('none');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const w = useWriter();
  const { says, doesNotSay } = termsOf(action);

  useEffect(() => {
    if (!shop) return;
    let cancelled = false;
    setAssets(null); setAssetId(null); setAssetsFailure(null);
    readJob('facility_read', { p_organization_id: shop }).then(l => {
      if (cancelled) return;
      if (l.status === 'loaded') { const a = facilityAssets(l.data); setAssets(a); setAssetId(a[0]?.assetId ?? null); } else if (l.status === 'failed') setAssetsFailure(l.reason);
    });
    return () => { cancelled = true; };
  }, [shop]);

  const send = async () => {
    const built = reserveArgs(action, assetId, from, until, fee, amount, currency);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('reserve_facility', built.args);
  };
  const picked = assets?.find(a => a.assetId === assetId);
  return <SignSheet title="Book a bay" says={says} doesNotSay={doesNotSay} confirmLabel="Ask the shop" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Request sent. The shop confirms or declines; until then it holds no space.</Text>}>
    {!w.done && <>
      {shops.length === 0 && <Text role="body">No shop is attached to this job yet, so there is nothing to book.</Text>}
      {shops.length > 1 && <label className="jb-field"><Text role="label">Shop</Text>
        <select className="jb-input k-body" aria-label="Shop" value={shop} onChange={e => setShop(e.target.value)}>{shops.map(s => <option key={s.organizationId} value={s.organizationId}>{s.name}</option>)}</select></label>}
      {shops.length === 1 && <div className="jb-field"><Text role="label">Shop</Text><Text role="body">{shops[0].name}</Text></div>}
      {assetsFailure && <Text role="body" className="jb-warn">{`Couldn't load the shop's spaces: ${assetsFailure}`}</Text>}
      {assets && assets.length === 0 && <Text role="body">This shop hasn't declared any spaces yet.</Text>}
      {assets && assets.length > 0 && <label className="jb-field"><Text role="label">Space</Text>
        <select className="jb-input k-body" aria-label="Space" value={assetId ?? ''} onChange={e => setAssetId(e.target.value)}>
          {assets.map(a => <option key={a.assetId} value={a.assetId}>{`${a.label} · ${a.kind.replace(/_/g, ' ')} · holds ${a.capacity}`}</option>)}</select></label>}
      {picked && picked.busy.length > 0 && <Text role="caption">{`Busy: ${picked.busy.slice(0, 6).map(b => [day(b.from), day(b.until)].filter(Boolean).join(' – ')).join('; ')}`}</Text>}
      <div className="jb-field--row">
        <label className="jb-field"><Text role="label">From</Text><input type="datetime-local" className="jb-input k-body" aria-label="From" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="jb-field"><Text role="label">Until</Text><input type="datetime-local" className="jb-input k-body" aria-label="Until" value={until} onChange={e => setUntil(e.target.value)} /></label>
      </div>
      <div className="jb-field--row">
        <label className="jb-field"><Text role="label">Fee you propose</Text>
          <select className="jb-input k-body" aria-label="Fee" value={fee} onChange={e => setFee(e.target.value as typeof fee)}>
            <option value="none">No fee</option><option value="hourly">Hourly</option><option value="day_rate">Day rate</option></select></label>
        {fee !== 'none' && <label className="jb-field"><Text role="label">Amount</Text><input className="jb-input jb-input--short k-body" aria-label="Fee amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>}
        {fee !== 'none' && <label className="jb-field"><Text role="label">Currency</Text><input className="jb-input jb-input--short k-body" aria-label="Fee currency" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value)} /></label>}
      </div>
    </>}
  </SignSheet>;
}

const CONFIRM_ACTION: JobAction = parseAction({ action: 'confirm_booking', rpc: 'confirm_facility_reservation' })!;

/** confirm_facility_reservation from a facility_reservation_to_confirm item in the signer's queue (its own sign hint). */
export function ConfirmBookingSheet({ item, onClose, onDone }: { item: JsonObject; onClose: () => void; onDone: () => void }) {
  const w = useWriter();
  const sign = obj(item.sign);
  const action = { ...CONFIRM_ACTION, binds: Array.isArray(sign?.binds) ? (sign!.binds as string[]) : typeof sign?.binds === 'string' ? [sign.binds] : [],
    doesNotBind: Array.isArray(sign?.does_not_bind) ? (sign!.does_not_bind as string[]) : [] };
  const { says, doesNotSay } = termsOf(action);
  const summary = obj(item.summary);
  const asset = obj(summary?.asset), clock = obj(item.clock);
  const send = async () => {
    const built = confirmBookingArgs(item);
    if (!built.ok) { w.setFailure(built.error); return; }
    await w.run('confirm_facility_reservation', built.args);
  };
  return <SignSheet title="Confirm a booking" says={says} doesNotSay={doesNotSay} confirmLabel="Confirm booking" onConfirm={send}
    onClose={w.done ? () => { onDone(); onClose(); } : onClose} busy={w.busy} failure={w.failure}
    done={w.done && <Text role="body" className="jb-done">Booking confirmed. The space is held for that window.</Text>}>
    <div className="jb-field"><Text role="label">Space</Text><Text role="body">{[str(asset?.label), str(obj(summary?.organization)?.name)].filter(Boolean).join(' · ') || 'Shop space'}</Text></div>
    <div className="jb-field"><Text role="label">When</Text><Text role="body">{[day(str(clock?.from)), day(str(clock?.until))].filter(Boolean).join(' – ') || 'Not stated'}</Text></div>
    <div className="jb-field"><Text role="label">Asked by</Text><Text role="body">{personLabel(summary?.requested_by)}</Text></div>
    {summary?.capacity_free === false && <Text role="body" className="jb-warn">Every space on this asset looks taken then. Confirming may be refused.</Text>}
  </SignSheet>;
}
