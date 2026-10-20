/**
 * PartsFinder — on a job page, for a viewer the operations reader names as an approver (part_approval.approver_role):
 * pick the job's parts or type new ones, search eBay for listings eBay itself matches to the job's vehicle
 * (extract-ebay-motors action "parts"), read why each ranked where it did, and approve a listing for the job
 * (approve_job_part_listing, a Sign: an explicit confirm with a reason; nothing commits on search or hover).
 * Nothing is bought here: approved listings hand off to eBay on /jobs/:id/parts.
 */
import React, { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Section, Text } from '../../kit';
import { arr, money, num, obj, str, type JsonObject } from './jobRead';
import { refusal } from './signDrafts';
import { ebayHref, ebayLinkNote } from './ebayLink';

const MAX_PARTS = 8;

type Query = { key: string; query: string; part_number: string | null; work_order_part_id: string | null };
type Listing = JsonObject;
type Phase = { step: 'idle' } | { step: 'searching' } | { step: 'done'; data: JsonObject; asked: Query[] } | { step: 'failed'; reason: string };

const timeOf = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const FIT_WORD: Record<string, string> = { exact: 'Exact fit', possible: 'Possible fit', unknown: 'Fit unknown' };

/** The finder's refusal or failure in words, from a non-2xx response body when there is one. */
async function failureOf(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = obj(await ctx.json());
      const said = str(body?.refused) ?? str(body?.error);
      if (said) return said;
    } catch { /* fall through */ }
  }
  return 'The parts finder could not search eBay right now.';
}

function Approve({ workOrderId, q, listing, onApproved }: { workOrderId: string; q: Query; listing: Listing; onApproved: () => void }) {
  const why = arr(listing.why).map(str).filter((s): s is string => !!s);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(why.slice(0, 2).join('; '));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const seen = timeOf(str(listing.observed_at));
  const sign = async () => {
    setBusy(true); setFailure(null);
    const { error } = await supabase.rpc('approve_job_part_listing', {
      p_work_order_id: workOrderId,
      p_listing: { ...listing, marketplace: 'ebay', seller_feedback_percentage: num(obj(listing.seller)?.feedback_percentage),
        seller_feedback_score: num(obj(listing.seller)?.feedback_score) },
      p_reason: reason.trim(),
      p_work_order_part_id: q.work_order_part_id,
      p_part_name: q.work_order_part_id ? null : q.query,
      p_part_number: q.work_order_part_id ? null : q.part_number,
      p_quantity: 1,
    });
    setBusy(false);
    if (error) { setFailure(refusal(error)); return; }
    setDone(true); setOpen(false); onApproved();
  };
  if (done) return <div role="status" className="jb-live"><Text role="caption">Approved for this job. It is on the parts list to buy.</Text></div>;
  if (!open) return <button type="button" className="job-button" onClick={() => setOpen(true)}><Text role="label">Approve for this job</Text></button>;
  return <div className="job-sign" role="group" aria-label="Approve this listing">
    <Text role="label" as="h3">Signing says</Text>
    <ul className="job-list">
      <li><Text role="body">You approve eBay item {str(listing.item_id)} for "{q.query}" on this job, for the reason below.</Text></li>
      <li><Text role="body">It is recorded with your role on the job and the time.</Text></li>
    </ul>
    <Text role="label" as="h3">It does not say</Text>
    <ul className="job-list">
      <li><Text role="body">Nothing is bought or ordered. You buy on eBay, through eBay's checkout.</Text></li>
      <li><Text role="body">The price is as read{seen ? ` at ${seen}` : ''}; eBay's page has the current price.</Text></li>
    </ul>
    <label className="job-block">
      <Text role="label">Why this listing</Text>
      <textarea className="job-textarea" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
    </label>
    <div role="alert" className="jb-live">{failure && <Text role="body" as="p" className="job-sign__failure">{failure}</Text>}</div>
    <div className="job-sign__buttons">
      <button type="button" className="job-button job-button--primary" disabled={busy || !reason.trim()} onClick={sign}>
        <Text role="label">{busy ? 'Signing…' : 'Sign: approve this listing'}</Text>
      </button>
      <button type="button" className="job-button" disabled={busy} onClick={() => setOpen(false)}><Text role="label">Cancel</Text></button>
    </div>
  </div>;
}

function ListingRow({ l, workOrderId, q, onApproved }: { l: Listing; workOrderId: string; q: Query; onApproved: () => void }) {
  const href = ebayHref(str(l.item_url));
  const seller = obj(l.seller);
  const why = arr(l.why).map(str).filter((s): s is string => !!s);
  const total = num(l.total);
  const price = total !== null ? `${money(total, str(l.currency))} delivered` : `${money(num(l.price), str(l.currency))} + shipping not stated`;
  const img = str(l.image_url);
  return <li className="pf-listing">
    {img ? <img className="pf-listing__img" src={img} width={72} height={72} loading="lazy" alt="" /> : <span className="pf-listing__img" aria-hidden />}
    <div className="pf-listing__main">
      <Text role="label">#{num(l.rank)} · {FIT_WORD[str(l.fit) ?? 'unknown'] ?? 'Fit unknown'}</Text>
      <Text role="body">{str(l.title)}</Text>
      <Text role="measure" dense>{price}</Text>
      <Text role="caption">{[str(l.condition) ?? 'Condition not stated',
        num(seller?.feedback_percentage) !== null ? `seller ${num(seller?.feedback_percentage)}% of ${(num(seller?.feedback_score) ?? 0).toLocaleString('en-US')}` : 'seller feedback not stated',
        str(obj(l.item_location)?.postal_prefix) ? `ships from ${str(obj(l.item_location)?.postal_prefix)}` : null].filter(Boolean).join(' · ')}</Text>
      <details className="job-details">
        <summary><Text role="caption">Why #{num(l.rank)}</Text></summary>
        <ul className="job-list">{why.map(w => <li key={w}><Text role="body">{w}</Text></li>)}</ul>
      </details>
      <div className="pf-listing__actions">
        {href && <a className="job-button" href={href} target="_blank" rel="noopener noreferrer"><Text role="label">Open on eBay</Text></a>}
        <Approve workOrderId={workOrderId} q={q} listing={l} onApproved={onApproved} />
      </div>
    </div>
  </li>;
}

function PartResult({ p, q, workOrderId, onApproved }: { p: JsonObject; q: Query; workOrderId: string; onApproved: () => void }) {
  const fit = obj(p.fitment);
  const cat = obj(p.category);
  const steps = arr(fit?.steps).map(obj).filter((s): s is JsonObject => !!s);
  const unsent = steps.filter(s => !str(s.ebay));
  const shortlist = arr(p.shortlist).map(obj).filter((x): x is JsonObject => !!x);
  const total = num(p.ebay_total);
  return <div className="job-block pf-part" role="group" aria-label={`eBay listings for ${q.query}`}>
    <Text role="label" as="h3">{q.query}{q.part_number ? ` · ${q.part_number}` : ''}</Text>
    {p.status !== 'searched'
      ? <Text role="body" as="p">Not searched: {str(p.reason) ?? 'no reason given'}</Text>
      : <>
        <Text role="body" as="p">
          {fit?.established === true
            ? `${total !== null ? total.toLocaleString('en-US') : 'Unknown number of'} listings fit by eBay's table in ${str(cat?.name) ?? 'parts'} (${num(p.exact_read) ?? 0} exact of the ${num(p.read) ?? 0} read). ${str(fit?.note) ?? ''}.`
            : `Fitment could not be established: ${str(fit?.note) ?? 'unknown'}. Every listing below is unknown fit.`}
        </Text>
        {unsent.map(s => <Text key={str(s.property) ?? ''} role="caption" as="p">{str(s.property)}: {str(s.basis)}</Text>)}
        {str(obj(p.search)?.fallback) && <Text role="caption" as="p">{str(obj(p.search)?.fallback)}</Text>}
        {shortlist.length === 0 && <Text role="body" as="p">eBay returned no fixed-price listing for this.</Text>}
        {shortlist.length > 0 && <ol className="pf-listings">{shortlist.map(l => <ListingRow key={str(l.item_id) ?? ''} l={l} q={q} workOrderId={workOrderId} onApproved={onApproved} />)}</ol>}
        <Text role="caption" as="p">Read at {timeOf(str(p.observed_at)) ?? 'unknown time'}; prices may have changed since. {num(p.browse_calls) ?? 0} eBay search{num(p.browse_calls) === 1 ? '' : 'es'}.</Text>
      </>}
  </div>;
}

export default function PartsFinder({ workOrderId, vehicleId, parts, onApproved }: {
  workOrderId: string; vehicleId: string; parts: JsonObject[]; onApproved: () => void;
}) {
  const open = useMemo(() => parts.filter(p => !['installed', 'cancelled', 'not_used'].includes(str(p.status) ?? '')), [parts]);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [added, setAdded] = useState<Query[]>([]);
  const [name, setName] = useState('');
  const [pn, setPn] = useState('');
  const [zip, setZip] = useState('');
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });

  const queries: Query[] = [
    ...open.filter(p => chosen[str(p.id) ?? '']).map(p => ({ key: str(p.id)!, query: str(p.part_name) ?? 'part', part_number: str(p.part_number), work_order_part_id: str(p.id) })),
    ...added,
  ];
  const add = () => {
    const query = name.trim();
    if (!query || queries.length >= MAX_PARTS) return;
    setAdded(a => [...a, { key: `new-${a.length}-${query}`, query, part_number: pn.trim() || null, work_order_part_id: null }]);
    setName(''); setPn('');
  };
  const search = async () => {
    if (!queries.length) return;
    const asked = queries;
    setPhase({ step: 'searching' });
    const { data, error } = await supabase.functions.invoke('extract-ebay-motors', { body: {
      action: 'parts', vehicle_id: vehicleId, delivery_postal_code: /^\d{5}$/.test(zip.trim()) ? zip.trim() : undefined,
      parts: asked.map(q => ({ query: q.query, part_number: q.part_number, work_order_part_id: q.work_order_part_id })),
    } });
    if (error) { setPhase({ step: 'failed', reason: await failureOf(error) }); return; }
    const o = obj(data);
    setPhase(o ? { step: 'done', data: o, asked } : { step: 'failed', reason: 'The parts finder returned nothing.' });
  };
  const result = phase.step === 'done' ? phase.data : null;
  const asked = phase.step === 'done' ? phase.asked : [];
  const results = arr(result?.parts).map(obj).filter((x): x is JsonObject => !!x);
  const withExact = results.filter(p => (num(p.exact_read) ?? 0) > 0).length;

  return <Section title="Parts from eBay" coverage={result
    ? { n: withExact, of: results.length, grain: 'parts with an exact-fit listing', as_of: str(results.find(p => str(p.observed_at))?.observed_at) }
    : { n: queries.length, of: MAX_PARTS, grain: 'parts chosen (8 per search)', as_of: null }}>
    <Text role="body" as="p">Listings eBay itself matches to this vehicle, ranked by fit, then whether the title names the part, usable condition, delivered price, condition and seller feedback. Never by commission or promotion. Approving one puts it on this job's list to buy; nothing is bought here.</Text>
    {open.length > 0 && <fieldset className="pf-pick">
      <legend><Text role="label">Parts on this job</Text></legend>
      {open.map(p => {
        const id = str(p.id) ?? '';
        return <label key={id} className="pf-pick__item">
          <input type="checkbox" checked={!!chosen[id]} disabled={!chosen[id] && queries.length >= MAX_PARTS}
            onChange={e => setChosen(c => ({ ...c, [id]: e.target.checked }))} />
          <Text role="body">{str(p.part_name) ?? 'Part'}{str(p.part_number) ? ` · ${str(p.part_number)}` : ''}</Text>
        </label>;
      })}
    </fieldset>}
    <div className="pf-add" role="group" aria-label="Add a part to search">
      <label className="pf-add__field"><Text role="label">Part</Text>
        <input className="pf-input" value={name} maxLength={120} placeholder="fuel pump" onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /></label>
      <label className="pf-add__field"><Text role="label">Part number (optional)</Text>
        <input className="pf-input" value={pn} maxLength={60} onChange={e => setPn(e.target.value)} /></label>
      <button type="button" className="job-button" disabled={!name.trim() || queries.length >= MAX_PARTS} onClick={add}><Text role="label">Add</Text></button>
    </div>
    {added.length > 0 && <ul className="job-list">{added.map(q => <li key={q.key}>
      <Text role="body">{q.query}{q.part_number ? ` · ${q.part_number}` : ''} (new on this job when approved) </Text>
      <button type="button" className="pf-remove" onClick={() => setAdded(a => a.filter(x => x.key !== q.key))}><Text role="caption">remove</Text></button>
    </li>)}</ul>}
    <div className="pf-add">
      <label className="pf-add__field"><Text role="label">Ship to ZIP (optional, for shipping costs)</Text>
        <input className="pf-input pf-input--zip" value={zip} inputMode="numeric" maxLength={5} onChange={e => setZip(e.target.value.replace(/\D/g, ''))} /></label>
      <button type="button" className="job-button job-button--primary" disabled={!queries.length || phase.step === 'searching'} onClick={search}>
        <Text role="label">{phase.step === 'searching' ? 'Searching eBay…' : `Find exact-fit listings (${queries.length})`}</Text>
      </button>
    </div>
    <div role="status" className="jb-live">
      {phase.step === 'failed' && <Text role="body" as="p" className="job-sign__failure">{phase.reason}</Text>}
      {result && str(result.refused) && <Text role="body" as="p" className="job-sign__failure">{str(result.refused)}</Text>}
    </div>
    {results.map((p, i) => <PartResult key={asked[i]?.key ?? i} p={p} q={asked[i] ?? { key: String(i), query: str(p.query) ?? 'part', part_number: str(p.part_number), work_order_part_id: str(p.work_order_part_id) }}
      workOrderId={workOrderId} onApproved={onApproved} />)}
    {result && <Text role="caption" as="p">
      {num(obj(result.calls)?.browse) ?? 0} eBay searches this time; the finder has used {num(obj(result.quota)?.used_today) ?? '?'} of its {num(obj(result.quota)?.daily_cap) ?? 300} for today. {ebayLinkNote()}
    </Text>}
  </Section>;
}
