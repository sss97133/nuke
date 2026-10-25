/**
 * /jobs/:workOrderId/parts — the hand-off: every listing approved for this job's parts (work_order_operations_read,
 * parts[].approved_listings), each with one link to its eBay page, where the buyer adds to cart or buys through eBay's
 * own checkout. Prices are as the parts finder read them when the listing was approved; nothing is ordered here.
 * Same gate as the job page: anyone on a public vehicle's job, otherwise its parties. Approval reasons to parties only.
 */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PrefetchLink } from '../../components/PrefetchLink';
import { useAuth } from '../../hooks/useAuth';
import { usePageTitle } from '../../hooks/usePageTitle';
import { Masthead, Row, Rows, Section, Text } from '../../kit';
import { arr, day, money, num, obj, slotWord, str, vehicleText, type JsonObject } from './jobRead';
import { readJob, type Load } from './readJob';
import { ebayHref, ebayLinkNote } from './ebayLink';
import './job-page.css';

const FIT_WORD: Record<string, string> = { exact: 'exact fit by eBay', possible: 'possible fit by eBay', unknown: 'fit unknown' };

export function approvedParts(d: JsonObject | null): { part: JsonObject; approvals: JsonObject[] }[] {
  return arr(d?.parts).map(obj).filter((p): p is JsonObject => !!p)
    .map(part => ({ part, approvals: arr(part.approved_listings).map(obj).filter((a): a is JsonObject => !!a && !!obj(a.listing)) }))
    .filter(x => x.approvals.length > 0);
}

/** Sum of the delivered totals at approval time, per currency; listings without a stated shipping cost are counted apart. */
export function approvedTotals(rows: { approvals: JsonObject[] }[]): { totals: [string, number][]; unpriced: number } {
  const totals = new Map<string, number>();
  let unpriced = 0;
  for (const r of rows) for (const a of r.approvals) {
    const l = obj(a.listing)!;
    const t = num(l.total), cur = str(l.currency) ?? 'USD';
    if (t === null) { unpriced++; continue; }
    totals.set(cur, Math.round(((totals.get(cur) ?? 0) + t) * 100) / 100);
  }
  return { totals: [...totals], unpriced };
}

export default function JobPartsHandoff() {
  const { user, loading } = useAuth();
  const { workOrderId = '' } = useParams<{ workOrderId: string }>();
  if (loading) return <article className="job-page" aria-busy="true"><Text role="entity" as="h1">Loading the approved parts…</Text></article>;
  return <PartsForViewer key={`${user?.id ?? 'anonymous'}:${workOrderId}`} viewerId={user?.id ?? null} />;
}

function PartsForViewer({ viewerId }: { viewerId: string | null }) {
  const { workOrderId = '' } = useParams<{ workOrderId: string }>();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    readJob('work_order_operations_read', { p_work_order_id: workOrderId }, viewerId).then(l => { if (!cancelled) setLoad(l); });
    return () => { cancelled = true; };
  }, [workOrderId, viewerId]);
  const d = load.status === 'loaded' ? load.data : null;
  const vehicle = vehicleText(d?.vehicle_label);
  usePageTitle(`Parts to buy${vehicle ? ` · ${vehicle}` : ''}`);

  if (load.status !== 'loaded') {
    return <article className="job-page" aria-busy={load.status === 'loading'} aria-label="Parts to buy">
      <Masthead><Text role="entity" as="h1">Parts to buy</Text></Masthead>
      <section className="k-section job-block"><Text role="body" as="p">{load.status === 'loading' ? 'Loading the approved parts…' : load.reason}</Text></section>
    </article>;
  }
  const rows = approvedParts(d);
  const parts = arr(d?.parts).length;
  const { totals, unpriced } = approvedTotals(rows);
  const items = rows.reduce((n, r) => n + r.approvals.length, 0);

  return <article className="job-page" aria-label="Parts to buy">
    <Masthead result={<Text role="caption">{str(d?.display_title) ?? ''}</Text>}>
      <div className="job-masthead">
        <Text role="entity" as="h1">Parts to buy</Text>
        {vehicle && <Text role="body">{vehicle}</Text>}
        <PrefetchLink className="job-link" to={`/jobs/${workOrderId}`}><Text role="body">Back to the job</Text></PrefetchLink>
      </div>
    </Masthead>
    <Section title="Approved on eBay" coverage={{ n: rows.length, of: parts, grain: 'part lines with an approved listing', as_of: str(d?.as_of) }}>
      {rows.length === 0 && <Text role="body" as="p">No listing is approved for this job yet. Approve one from the job page's Parts from eBay section.</Text>}
      {rows.map(({ part, approvals }) => <Rows key={str(part.id) ?? ''} title={`${str(part.part_name) ?? 'Part'}${num(part.quantity) ? ` · qty ${num(part.quantity)}` : ''}`} count={approvals.length}>
        {approvals.map(a => {
          const l = obj(a.listing)!;
          const href = ebayHref(str(l.item_url));
          const total = num(l.total);
          return <Row key={str(a.approval_id) ?? ''} label={str(l.title) ?? `eBay item ${str(l.item_id)}`}>
            {total !== null ? `${money(total, str(l.currency))} delivered` : `${money(num(l.price), str(l.currency))} + shipping not stated`}
            {` · ${FIT_WORD[str(l.fit) ?? 'unknown'] ?? 'fit unknown'} · ${str(l.condition) ?? 'condition not stated'}`}
            {` · read ${day(str(l.observed_at)) ?? 'unknown day'}, approved ${day(str(a.approved_at)) ?? ''} by the ${slotWord(str(a.approver_role) ?? 'party').toLowerCase()}`}
            {str(a.reason) ? ` · why: ${str(a.reason)}` : ''}
            {href && <>{' · '}<a className="job-link" href={href} target="_blank" rel="noopener noreferrer">Open on eBay</a></>}
          </Row>;
        })}
      </Rows>)}
      {items > 0 && <Rows title="At approval time">
        {totals.map(([cur, t]) => <Row key={cur} label={`Total, ${items - unpriced} of ${items} listings`} role="measure">{money(t, cur)}</Row>)}
        {unpriced > 0 && <Row label="Shipping not stated">{unpriced === 1 ? 'One listing states no shipping cost' : `${unpriced} listings state no shipping cost`}</Row>}
      </Rows>}
      <Text role="caption" as="p">Prices are as read when each listing was approved; eBay's page has the current price and stock. Buying happens on eBay, through eBay's checkout. {ebayLinkNote()}</Text>
    </Section>
  </article>;
}
