import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Target = { listing_url: string; first_discovered_at: string | null; last_seen_at: string | null };
type Source = { source_slug: string; display_name: string; total_targets: number; targets: Target[] };
type Activity = { contract: string; calculated_at: string; total_listings: number; total_sold: number;
  total_unsold: number; active_listings: number; unknown_outcomes: number; unresolved_identity_rows: number;
  input_rows: number; unpriced_sold: number; identity_conflicts: number; outcome_conflicts: number;
  amount_conflicts: number; unknown_currency_sold: number; sell_through_rate: number | null;
  latest_input_created_at: string | null; latest_input_extracted_at: string | null;
  currencies: { currency: string; listings: number; total: number }[]; currencies_complete: boolean };
type Reading = { contract: string; organization_id: string; status: string; measured_at: string; complete: boolean; rows: Source[];
  listing_activity?: { status: string; rows: Activity[] } };
const validActivity = (a: Activity) => a?.contract === 'listing_activity_v1'
  && Number.isFinite(Date.parse(a.calculated_at))
  && [a.total_listings, a.total_sold, a.total_unsold, a.active_listings, a.unknown_outcomes,
    a.unresolved_identity_rows, a.input_rows, a.unpriced_sold, a.identity_conflicts, a.outcome_conflicts,
    a.amount_conflicts, a.unknown_currency_sold].every(n => Number.isSafeInteger(n) && n >= 0)
  && (a.sell_through_rate === null || (Number.isFinite(a.sell_through_rate) && a.sell_through_rate >= 0 && a.sell_through_rate <= 100))
  && typeof a.currencies_complete === 'boolean' && Array.isArray(a.currencies) && a.currencies.length <= 30
  && a.total_sold + a.total_unsold + a.active_listings + a.unknown_outcomes === a.total_listings
  && a.input_rows >= a.total_listings + a.unresolved_identity_rows
  && a.currencies.every(c => /^[A-Z]{3}$/.test(c.currency) && Number.isFinite(c.total) && c.total > 0
    && Number.isSafeInteger(c.listings) && c.listings > 0);
const safeUrl = (value: string) => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Unmeasured';
const cell = { padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'left' as const };

export default function OrganizationSourceTargets({ organizationId }: { organizationId: string }) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(`db-stats?organization_targets=${encodeURIComponent(organizationId)}`,
          { method: 'GET', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
        if (error || data?.contract !== 'organization_targets_v1' || data.organization_id !== organizationId
          || data.status !== 'measured' || !Number.isFinite(Date.parse(data.measured_at)) || typeof data.complete !== 'boolean'
          || !Array.isArray(data.rows) || data.rows.length > 30 || !data.rows.every((s: Source) => s
            && typeof s.source_slug === 'string' && typeof s.display_name === 'string'
            && Number.isSafeInteger(s.total_targets) && s.total_targets >= 0
            && Array.isArray(s.targets) && s.targets.length <= 25 && s.targets.length <= s.total_targets
            && s.targets.every(t => t && typeof t.listing_url === 'string' && safeUrl(t.listing_url)))) throw new Error('unavailable');
        if (!cancelled) setReading(data);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [organizationId]);

  useEffect(() => {
    if (reading && window.location.hash === '#source-targets') document.getElementById('source-targets')?.scrollIntoView?.();
  }, [reading]);

  const sources = reading?.rows.filter(s => s.total_targets > 0) ?? [];
  const activity = reading?.listing_activity?.status === 'measured' && Array.isArray(reading.listing_activity.rows) && reading.listing_activity.rows.length === 1
    && validActivity(reading.listing_activity.rows[0]) ? reading.listing_activity.rows[0] : null;
  if (failed) return <p id="source-targets" role="status">Source target inventory unavailable.</p>;
  if (!reading || (sources.length === 0 && !activity)) return null;
  return <section id="source-targets" aria-labelledby="source-targets-heading"
    style={{ border: '2px solid var(--border)', padding: 12, marginBottom: 16, fontSize: 11 }}>
    <h3 id="source-targets-heading" style={{ fontSize: 11 }}>SOURCE EVIDENCE AND LISTING ACTIVITY</h3>
    {activity && <div>
      <p><strong>{activity.total_listings.toLocaleString()} attributed listing episodes</strong> · {activity.total_sold.toLocaleString()} reported sold · {activity.total_unsold.toLocaleString()} reserve not met · {activity.active_listings.toLocaleString()} active · {activity.unknown_outcomes.toLocaleString()} unresolved outcomes</p>
      <p>Calculated {date(activity.calculated_at)} from {activity.input_rows.toLocaleString()} retained records. Latest record captured {date(activity.latest_input_extracted_at)}; latest record admitted {date(activity.latest_input_created_at)}. Covers recorded listings attributed to this organization; does not establish complete market coverage.</p>
      <p>{activity.sell_through_rate === null ? 'Sell-through unmeasured: the outcome population is incomplete.' : `Sell-through ${activity.sell_through_rate}% across known closed listings.`} {activity.unresolved_identity_rows.toLocaleString()} records lack listing identity; {activity.identity_conflicts.toLocaleString()} identity conflicts, {activity.outcome_conflicts.toLocaleString()} outcome conflicts.</p>
      {activity.currencies.map(c => <p key={c.currency}>{c.currency} {c.total.toLocaleString()} source-reported sale amounts · {c.listings.toLocaleString()} priced sales</p>)}
      <p>{activity.unpriced_sold.toLocaleString()} reported sales lack a usable amount and currency, including {activity.unknown_currency_sold.toLocaleString()} with unknown currency. {activity.amount_conflicts.toLocaleString()} amount or currency conflicts. Sale amounts do not establish company revenue.</p>
      {!activity.currencies_complete && <p>First 30 currencies shown.</p>}
    </div>}
    {sources.length > 0 && <p>Known source targets · read {date(reading.measured_at)}. URLs from source sitemaps; discovery does not prove extraction, a verified vehicle or a sale.</p>}
    {!reading.complete && <p>First 30 source keys only.</p>}
    {sources.map(source => <div key={source.source_slug}>
      <p><strong>{source.display_name}</strong> · {source.total_targets.toLocaleString()} known target URLs</p>
      <details>
        <summary>View {source.targets.length} retained target URLs · bounded sample, unranked</summary>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Source page', 'First discovered', 'Last seen in inventory'].map(label => <th key={label} scope="col" style={cell}>{label}</th>)}</tr></thead>
          <tbody>{source.targets.map(target => <tr key={target.listing_url}>
            <td style={{ ...cell, overflowWrap: 'anywhere' }}><a href={target.listing_url} target="_blank" rel="noopener noreferrer">{target.listing_url}</a></td>
            <td style={cell}>{date(target.first_discovered_at)}</td><td style={cell}>{date(target.last_seen_at)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </div>)}
  </section>;
}
