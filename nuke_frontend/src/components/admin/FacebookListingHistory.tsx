import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Observation = { sighting_id: string; capture_id: string; observed_at: string;
  intake_started_at: string; capture_acknowledged_at: string; known_by: string;
  asking_amount: number | null; asking_currency: string | null;
  source_reported_listed_at: string | null; source_reported_age_label: string | null;
  detail_observation: boolean; retrieval_surface: string | null; actual_region: string | null;
  actual_url: string; target_url: string; source_scope_complete: boolean | null };
type History = { listing_id: string; facebook_id: string; title: string | null; current_vehicle_id: string | null;
  first_observed_at: string; last_observed_at: string; observed_span_minutes: number;
  observation_count: number; search_sightings: number; detail_observations: number;
  same_query_revisits: number; observed_asking_changes: number; observations: Observation[] };
export type ListingHistoryReading = { contract: 'facebook_listing_history_v1'; section: 'listing_history'; status: 'measured';
  measured_at: string; capture_window_complete: boolean; rows: History[];
  summary: { selected_runs: number; acknowledged_runs: number; withheld_runs: number; retained_sightings: number;
    listing_histories: number; repeated_histories: number; histories_with_asking_changes: number };
  scope: { event_from: string; event_before: string; knowledge_cutoff: string; capture_limit: 100; listing_limit: 20;
    basis: string; knowledge_basis: string; availability_between_observations: 'unobserved';
    continuous_active_duration: null; confirmed_sale: null; relist_identity: 'unresolved' } };

const at = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export const facebookListingUrl = (id: string) => /^\d+$/.test(id) ? `https://www.facebook.com/marketplace/item/${id}/` : null;
export function validListingHistory(data: unknown): data is ListingHistoryReading {
  const d = data as ListingHistoryReading;
  return d?.contract === 'facebook_listing_history_v1' && d.section === 'listing_history' && d.status === 'measured'
    && at(d.measured_at) && typeof d.capture_window_complete === 'boolean'
    && d.scope?.capture_limit === 100 && d.scope.listing_limit === 20
    && d.scope.basis === 'retained_listing_sightings_in_selected_acknowledged_captures'
    && d.scope.knowledge_basis === 'capture_completion_upper_bound_not_per_sighting_admission_or_commit_time'
    && d.scope.availability_between_observations === 'unobserved' && d.scope.continuous_active_duration === null
    && d.scope.confirmed_sale === null && d.scope.relist_identity === 'unresolved'
    && [d.scope.event_from,d.scope.event_before,d.scope.knowledge_cutoff].every(at)
    && d.summary && Object.values(d.summary).every(count)
    && d.summary.selected_runs <= 100 && d.summary.acknowledged_runs + d.summary.withheld_runs === d.summary.selected_runs
    && d.summary.retained_sightings <= d.summary.acknowledged_runs * 50
    && d.summary.repeated_histories <= d.summary.listing_histories
    && Array.isArray(d.rows) && d.rows.length <= 20 && d.rows.length <= d.summary.listing_histories
    && new Set(d.rows.map(h => h?.listing_id)).size === d.rows.length
    && d.rows.every(h => h && typeof h.listing_id === 'string' && /^\d+$/.test(h.facebook_id)
      && (h.title === null || typeof h.title === 'string')
      && [h.first_observed_at,h.last_observed_at].every(at)
      && Number.isFinite(h.observed_span_minutes) && h.observed_span_minutes >= 0
      && [h.observation_count,h.search_sightings,h.detail_observations,h.same_query_revisits,h.observed_asking_changes].every(count)
      && h.observation_count === h.search_sightings + h.detail_observations && h.observation_count <= 100
      && Array.isArray(h.observations) && h.observations.length === h.observation_count
      && new Set(h.observations.map(o => o?.sighting_id)).size === h.observation_count
      && h.observations.every((o,i) => o && [o.observed_at,o.intake_started_at,o.capture_acknowledged_at,o.known_by].every(at)
        && Date.parse(o.observed_at) >= Date.parse(d.scope.event_from) && Date.parse(o.observed_at) < Date.parse(d.scope.event_before)
        && Date.parse(o.known_by) <= Date.parse(d.scope.knowledge_cutoff)
        && Date.parse(o.known_by) >= Math.max(Date.parse(o.observed_at),Date.parse(o.capture_acknowledged_at))
        && (i === 0 || Date.parse(o.observed_at) >= Date.parse(h.observations[i-1].observed_at))
        && typeof o.detail_observation === 'boolean' && (o.asking_amount === null || Number.isFinite(o.asking_amount) && o.asking_amount >= 0)
        && (o.asking_currency === null || ['USD','EUR','GBP','CAD','AUD'].includes(o.asking_currency))
        && (o.source_reported_listed_at === null || at(o.source_reported_listed_at))
        && (o.source_reported_age_label === null || typeof o.source_reported_age_label === 'string')));
}
const stamp = (value: string) => new Date(value).toLocaleString();
const cell = { padding: '6px 8px', textAlign: 'left' as const, verticalAlign: 'top' as const, borderBottom: '1px solid var(--border)' };
const asking = (o: Observation) => o.asking_amount === null ? 'Asking unmeasured'
  : `${o.asking_amount.toLocaleString()} ${o.asking_currency ?? '· currency unknown'}`;

export default function FacebookListingHistory({ busy = false }: { busy?: boolean }) {
  const [reading,setReading] = useState<ListingHistoryReading | null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState(false);
  const [facebookId,setFacebookId] = useState('');
  const [before,setBefore] = useState('');
  const [knownAt,setKnownAt] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const load = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(false);
    try {
      const params = new URLSearchParams({ intake: 'listing_history' });
      if (facebookId.trim()) params.set('facebook_id',facebookId.trim());
      if (before) params.set('history_before',new Date(before).toISOString());
      if (knownAt) params.set('history_known_at',new Date(knownAt).toISOString());
      const { data,error: failed } = await supabase.functions.invoke(`db-stats?${params}`, {
        method: 'GET',signal: AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)]) });
      if (failed || !validListingHistory(data)) throw new Error('unavailable');
      if (!controller.signal.aborted) setReading(data);
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  return <details id="status-listing-history" style={{ border: '2px solid var(--border)',padding: 12,marginBottom: 16 }}>
    <summary style={{ fontWeight: 700 }}>FACEBOOK LISTING HISTORY</summary>
    <p>Retained sightings and asking history, including listings whose vehicle identity is unresolved.</p>
    <form onSubmit={e => { e.preventDefault(); void load(); }} style={{ display: 'flex',flexWrap: 'wrap',gap: 12,alignItems: 'end' }}>
      <label>Facebook listing ID <input type="text" inputMode="numeric" value={facebookId} onChange={e => setFacebookId(e.target.value)} /></label>
      <label>Observed before <input type="datetime-local" value={before} onChange={e => setBefore(e.target.value)} /></label>
      <label>Known by <input type="datetime-local" value={knownAt} onChange={e => setKnownAt(e.target.value)} /></label>
      <button type="submit" disabled={busy || loading}>{loading ? 'Reading histories…' : 'Read listing histories'}</button>
    </form>
    <p>Blank cutoffs use the current time. The observation window is the preceding 24 hours.</p>
    {error && <p role="status">Listing history unavailable. Any retained reading below keeps its original scope and date.</p>}
    {reading && <>
      <p>Read {stamp(reading.measured_at)} · Observed {stamp(reading.scope.event_from)} to {stamp(reading.scope.event_before)} · Known by {stamp(reading.scope.knowledge_cutoff)}.</p>
      <p>{reading.capture_window_complete ? '' : 'First 100 captures only · '}
        {reading.summary.retained_sightings} retained sightings · {reading.summary.listing_histories} listing histories · {reading.summary.repeated_histories} repeated histories · {reading.summary.histories_with_asking_changes} with observed asking changes.</p>
      <p>{reading.summary.acknowledged_runs} acknowledged captures / {reading.summary.selected_runs} selected · {reading.summary.withheld_runs} withheld by clocks or receipt qualification.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%',borderCollapse: 'collapse' }}>
        <thead><tr>{['Source listing','Observed span','Search revisits / detail observations','Asking history'].map(s => <th scope="col" key={s} style={cell}>{s}</th>)}</tr></thead>
        <tbody>{reading.rows.map(h => <tr key={h.listing_id}>
          <th scope="row" style={cell}><a href={facebookListingUrl(h.facebook_id) ?? undefined} target="_blank" rel="noopener noreferrer">{h.title || h.facebook_id}</a>
            <div>{h.current_vehicle_id ? 'Current vehicle link exists' : 'Vehicle identity unresolved'}</div></th>
          <td style={cell}>{h.observed_span_minutes.toFixed(2)} min<div>{stamp(h.first_observed_at)} → {stamp(h.last_observed_at)}</div></td>
          <td style={cell}>{h.same_query_revisits} same-query revisits · {h.search_sightings} search sightings · {h.detail_observations} detail observations</td>
          <td style={cell}><details><summary>{h.observation_count} observations · {h.observed_asking_changes} asking changes</summary>
            <ol>{h.observations.map(o => <li key={o.sighting_id}>{stamp(o.observed_at)} · {asking(o)} · {o.detail_observation ? 'Detail' : 'Search'}
              <div>Recorded by {stamp(o.capture_acknowledged_at)} · {o.actual_region ?? 'Region unmeasured'}</div>
              <div>{o.source_reported_listed_at ? `Source-reported listed time: ${stamp(o.source_reported_listed_at)}` : 'Exact listed time unmeasured'}
                {o.source_reported_age_label && ` · Source age label: ${o.source_reported_age_label}`}</div>
              <div>{o.source_scope_complete === true ? 'Declared complete capture' : 'Partial or undeclared capture scope'} · Presence between observations unobserved.</div>
            </li>)}</ol>
          </details></td>
        </tr>)}</tbody>
      </table></div>
      <p>Showing {reading.rows.length} / {reading.summary.listing_histories} histories, with repeats first. Use a listing ID to inspect one history.</p>
      {reading.rows.length === 0 && <p>No acknowledged listing history in this reading. Source coverage and availability remain unknown.</p>}
      <p>Observed span is supported by retained appearances. Continuous availability, relist identity and sale outcome remain unresolved. “Known by” uses capture completion; per-sighting admission and commit time are unmeasured.</p>
    </>}
  </details>;
}
