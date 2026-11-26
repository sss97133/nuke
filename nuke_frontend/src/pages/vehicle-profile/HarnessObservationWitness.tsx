import { useEffect, useState } from 'react';
import Link from '../../components/PrefetchLink';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

interface Witness {
  vehicle_id: string; observation_id: string; content_text: string | null; citation_excerpt: string | null;
  citation_page_number: number | null; source_url: string | null; observed_at: string | null; ingested_at: string | null;
  historical: boolean; superseded_at: string | null; superseded_by: string | null;
  source_name: string | null; confidence_score: number | null; claim: Record<string, string>;
  edges: { id: string; row_kind: string; row_id: string; field: string | null; relation: string; target_revision: string }[];
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown) => typeof value === 'string' ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const rowKinds = new Set(['signal', 'net', 'segment', 'termination', 'endpoint']);
const relations = new Set(['supports', 'needs_bench', 'open', 'contradicts']);
const revisions = new Set(['superseded', 'current_record', 'not_recorded']);
function sourceLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
/** No client ownership verdict: accept only the exact qualified server projection. */
export function readHarnessWitness(value: unknown, vehicleId: string, observationId: string): Witness | null {
  if (!object(value) || value.schema_version !== 1 || value.visibility !== 'vehicle_owner' || value.kind !== 'specification'
    || value.vehicle_id !== vehicleId || value.observation_id !== observationId || typeof value.historical !== 'boolean'
    || !Array.isArray(value.evidence_edges) || !value.evidence_edges.length) return null;
  const edges: Witness['edges'] = [];
  for (const edge of value.evidence_edges) {
    if (!object(edge) || edge.observation_id !== observationId || typeof edge.id !== 'string' || typeof edge.row_id !== 'string'
      || typeof edge.row_kind !== 'string' || !rowKinds.has(edge.row_kind) || typeof edge.relation !== 'string' || !relations.has(edge.relation)
      || typeof edge.target_revision !== 'string' || !revisions.has(edge.target_revision)) return null;
    edges.push({ id: edge.id, row_id: edge.row_id, row_kind: edge.row_kind, field: string(edge.field), relation: edge.relation, target_revision: edge.target_revision });
  }
  const claim: Record<string, string> = {};
  for (const key of ['property_key', 'row_field', 'value', 'state', 'citation']) if (object(value.claim) && typeof value.claim[key] === 'string') claim[key] = value.claim[key];
  return { vehicle_id: vehicleId, observation_id: observationId, content_text: string(value.content_text), citation_excerpt: string(value.citation_excerpt),
    citation_page_number: number(value.citation_page_number), source_url: sourceLink(value.source_url), observed_at: string(value.observed_at), ingested_at: string(value.ingested_at),
    historical: value.historical, superseded_at: string(value.superseded_at), superseded_by: string(value.superseded_by),
    source_name: object(value.source) ? string(value.source.display_name) : null, confidence_score: number(value.confidence_score), claim, edges };
}
const stamp = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';
const label = (value: string) => value.replaceAll('_', ' ');

export default function HarnessObservationWitness({ vehicleId, observationId }: { vehicleId: string; observationId: string }) {
  const { user } = useAuth();
  const canRequest = !!user && user.is_anonymous !== true;
  const subject = `${user?.id ?? 'public'}:${canRequest}:${vehicleId}:${observationId}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ subject: string; status: 'loading' | 'available' | 'unavailable' | 'error'; witness: Witness | null } | null>(null);
  useEffect(() => {
    if (!canRequest) { setState(null); return; }
    let cancelled = false;
    const controller = new AbortController(), timeout = window.setTimeout(() => controller.abort(), 10_000);
    setState({ subject, status: 'loading', witness: null });
    (async () => {
      try {
        const response = await supabase.rpc('harness_evidence_witness', { p_vehicle_id: vehicleId, p_observation_id: observationId }).abortSignal(controller.signal);
        if (cancelled) return;
        if (response.error) { setState({ subject, status: 'error', witness: null }); return; }
        const witness = readHarnessWitness(response.data, vehicleId, observationId);
        setState({ subject, status: witness ? 'available' : 'unavailable', witness });
      } catch { if (!cancelled) setState({ subject, status: 'error', witness: null }); }
      finally { window.clearTimeout(timeout); }
    })();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [canRequest, subject, vehicleId, observationId, attempt]);
  const current = canRequest && state?.subject === subject ? state : null;
  const witness = current?.witness;
  return <section className="harness-owner-witness" aria-label="Owner wiring source">
    <h2>Owner wiring source</h2>
    {!canRequest ? <p>Sign in as the vehicle owner to request this wiring source. Public source text remains withheld.</p>
      : !current || current.status === 'loading' ? <p role="status">Reading owner-authorized wiring source…</p>
      : !witness ? <><p role="status">{current.status === 'error' ? 'The owner wiring source could not be read. Try again.' : 'Owner wiring source is not available for this account or record.'}</p>
        {current.status === 'error' && <button type="button" onClick={() => setAttempt(n => n + 1)}>Retry owner source</button>}</>
      : <>
        <p>Owner-only source · recorded testimony</p>
        {witness.historical && <p className="harness-witness-history" role="status">Historical observation — this witness was superseded. It does not establish support for the current design.</p>}
        <dl><div><dt>Source</dt><dd>{witness.source_name ?? 'Source label unavailable'}</dd></div>
          <div><dt>Observed</dt><dd>{stamp(witness.observed_at)}</dd></div><div><dt>Recorded</dt><dd>{stamp(witness.ingested_at)}</dd></div>
          {witness.confidence_score !== null && <div><dt>Stored confidence</dt><dd>{Math.round(witness.confidence_score * 100)}% · verification unassessed</dd></div>}</dl>
        {witness.content_text ? <p className="harness-witness-text">{witness.content_text}</p> : <p>No retained claim text was included.</p>}
        {!!Object.keys(witness.claim).length && <dl>{Object.entries(witness.claim).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd className="harness-witness-text">{value}</dd></div>)}</dl>}
        {witness.citation_excerpt && <blockquote className="harness-witness-text">{witness.citation_excerpt}</blockquote>}
        {witness.citation_page_number !== null && <p>Cited page {witness.citation_page_number}</p>}
        {witness.source_url && <p><a href={witness.source_url} target="_blank" rel="noopener noreferrer">Open original source reference</a> · external reference; stored source bytes are not established by this link.</p>}
        {witness.historical && witness.superseded_by && <p><Link to={`/vehicle/${encodeURIComponent(vehicleId)}/observation/${encodeURIComponent(witness.superseded_by)}`}>Inspect successor observation</Link></p>}
        <h3>Recorded evidence links</h3><ul>{witness.edges.map(edge => <li key={edge.id}>{label(edge.row_kind)} <code>{edge.row_id}</code> · {label(edge.relation)}{edge.field && ` · ${edge.field}`}
          {edge.target_revision === 'superseded' && <strong> · retained target record</strong>}</li>)}</ul>
        <p>These are recorded claims and relationships. They do not establish construction approval.</p>
      </>}
  </section>;
}
