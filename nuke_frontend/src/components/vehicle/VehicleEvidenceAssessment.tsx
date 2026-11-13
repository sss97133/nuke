import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { assertVehicleAssessment } from '../../services/listingPackageEvidence';
import type { ListingAssessment, ListingAssertion } from '../../services/listingPackageEvidence';

export default function VehicleEvidenceAssessment({ assessment, assertions, unresolvedFields, vehicleId }: {
  assessment: ListingAssessment; assertions: ListingAssertion[]; unresolvedFields: Array<{ field: string; reason: string }>; vehicleId: string;
}) {
  const pkg = { assessment, listing_assertions: assertions, unresolved_fields: unresolvedFields };
  const [marketLimit, setMarketLimit] = useState(10);
  const market = assessment.market;
  const appearances = assessment.retained_auction_appearances;
  const records = Array.isArray(market.records) ? market.records : [];
  const amount = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: market.receipt?.currency || 'USD' }).format(n);
  return <section aria-label="Vehicle evidence assessment">
    <h3>Evidence assessment</h3>
    <dl>
      <dt>Market context</dt>
      <dd>{market.status === 'available' && market.statistics
        ? <>{market.statistics.sold_count} source-qualified sale episodes.
          {typeof market.statistics.median === 'number' && <> Recorded median: {amount(market.statistics.median)}.</>}
          {' '}Configuration and condition adjustments remain unestablished.</>
        : 'Market evidence could not be qualified for this package.'}</dd>
      <dt>Comparison class</dt><dd>Installed and factory configuration remain unresolved.</dd>
      <dt>Commentary</dt><dd>{assessment.commentary.status === 'retained_candidate_interpretations'
        ? 'Retained interpretations are cited candidate claims. Questions remain questions.'
        : assessment.commentary.status === 'unavailable' ? 'Commentary could not be read.' : 'No qualified commentary assessment is established.'}</dd>
      <dt>Photo audit</dt><dd>{assessment.photo_audit.status === 'unavailable' ? 'Gallery sources could not be read.'
        : 'Gallery sources are retained. Filing correctness, full capture coverage and mechanical condition remain unassessed.'}</dd>
    </dl>
    {!!records.length && <details><summary>Market sources ({records.length})</summary>
      <ol>{records.slice(0, marketLimit).map((r, i) => <li key={r.sourceUrl + ':' + i}>
        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">{amount(r.amount)} · {r.eventAt}</a>
      </li>)}</ol>
      {marketLimit < records.length && <button type="button" onClick={() => setMarketLimit(n => n + 10)}>Read more market sources</button>}
    </details>}
    {!!appearances?.records.length && <details><summary>Publisher-reported archive results</summary>
      <p>McCormick archive claims. Currency and fee treatment remain unestablished. No-sale bids are unsuccessful bids; these readings do not enter the qualified sale-price statistics.</p>
      <ul>{appearances.records.map(r => <li key={r.native_appearance_key}>
        {r.evidence_state === 'disputed' && <p>Conflicting source claims remain unresolved.</p>}
        <ul>{r.witnesses.map(w => <li key={w.observation_id}>
          <a href={w.source_url} target="_blank" rel="noopener noreferrer">{w.literal} · {w.source_date_interval_text}</a>
          {' '}Captured {w.source_captured_at.slice(0, 10)}.{' '}
          <a href={'/vehicle/' + vehicleId + '/observation/' + w.observation_id} target="_blank" rel="noopener noreferrer">Retained source reading</a>
        </li>)}</ul>
      </li>)}</ul>
      <p>Repeated captures are grouped within this page. Publisher date ranges do not establish exact sale times.</p>
      {appearances.page?.has_more && <p>More retained source readings remain beyond this page.</p>}
    </details>}
    {!!assessment.commentary.records?.length && <details><summary>Commentary sources ({assessment.commentary.records.length})</summary>
      <ul>{assessment.commentary.records.map(r => <li key={r.observation_id}>
        {r.statement_kind} · {r.subject_scope}: <q>{r.quote}</q>{' '}
        <a href={r.source_url} target="_blank" rel="noopener noreferrer">Original comment source</a>
      </li>)}</ul>
      {assessment.commentary.page?.has_more && <p>More retained commentary remains beyond this page.</p>}
      {!!assessment.commentary.exclusions?.length && <p>{assessment.commentary.exclusions.length} retained readings were excluded because their current source or method could not be qualified.</p>}
    </details>}
    {!!assessment.photo_audit.records?.length && <details><summary>Photo sources ({assessment.photo_audit.records.length})</summary>
      <ul>{assessment.photo_audit.records.map((r, i) => <li key={r.image_id}>
        <a href={r.source_url} target="_blank" rel="noopener noreferrer">Gallery source {i + 1}</a>
      </li>)}</ul>
      {assessment.photo_audit.has_more && <p>More gallery sources remain beyond this page.</p>}
    </details>}
    {!!pkg.listing_assertions.length && <details><summary>Sources for the prepared copy</summary><ul>
      {pkg.listing_assertions.map(a => <li key={a.field}>{a.statement}{' '}
        {a.sources.map(s => <a key={s.observation_id} href={'/vehicle/' + vehicleId + '/observation/' + s.observation_id} target="_blank" rel="noopener noreferrer">Evidence{' '}</a>)}
      </li>)}
    </ul></details>}
    <details><summary>Unresolved fields ({pkg.unresolved_fields.length})</summary><ul>
      {pkg.unresolved_fields.map((f, i) => <li key={f.field + ':' + i}>{f.field === '*' ? 'More source claims remain to be read.'
        : f.field.replaceAll('_', ' ') + ': needs cited supporting evidence.'}</li>)}
    </ul></details>
    {Array.isArray(assessment.attestations) && assessment.attestations.length > 0 && <details><summary>Contributor statements</summary><ul>
      {assessment.attestations.map(a => <li key={a.observation_id}>{a.source?.name || 'Contributor'}: {a.statement}{' '}
        <a href={'/vehicle/' + vehicleId + '/observation/' + a.observation_id} target="_blank" rel="noopener noreferrer">Statement source</a>
      </li>)}
    </ul><p>These statements retain their attribution and do not independently verify the mechanical claims.</p></details>}
  </section>;
}

/** The existing read-only review, shared by legacy and current profile callers. */
export function useVehicleEvidenceReview(vehicleId: string) {
  const [review, setReview] = useState<{ id: string; loading: boolean; error?: string; assessment?: ListingAssessment }>({ id: vehicleId, loading: false });
  const requestGeneration = useRef(0);
  const currentVehicle = useRef(vehicleId);
  currentVehicle.current = vehicleId;
  useEffect(() => () => { requestGeneration.current++; }, [vehicleId]);
  const loading = review.id === vehicleId && review.loading;
  const assessment = review.id === vehicleId ? review.assessment : undefined;
  const error = review.id === vehicleId ? review.error : undefined;

  const read = async () => {
    const generation = ++requestGeneration.current;
    const subject = vehicleId;
    setReview(previous => ({ id: subject, loading: true, assessment: previous.id === subject ? previous.assessment : undefined }));
    try {
      const { data: result, error } = await supabase.functions.invoke('compute-vehicle-valuation', {
        body: { action: 'assessment', vehicle_id: subject },
      });
      if (error || result?.action !== 'assessment' || result?.read_only !== true) throw new Error('Vehicle evidence could not be read.');
      assertVehicleAssessment(result.assessment, subject);
      if (requestGeneration.current === generation && currentVehicle.current === subject) {
        setReview({ id: subject, loading: false, assessment: result.assessment });
      }
    } catch (error) {
      if (requestGeneration.current === generation && currentVehicle.current === subject) setReview(previous => ({
        ...previous, id: subject, loading: false, error: error instanceof Error ? error.message : 'Vehicle evidence could not be read.',
      }));
    }
  };

  return { loading, assessment, error, read };
}

export function VehicleEvidenceReview({ vehicleId }: { vehicleId: string }) {
  const { loading, assessment, error, read } = useVehicleEvidenceReview(vehicleId);
  return <section aria-label="Review vehicle evidence">
    <button type="button" className="button button-secondary btn-md" disabled={loading} onClick={() => { void read(); }}>Review evidence</button>
    {loading && <p role="status">Reading retained evidence…</p>}
    {error && <p role="alert">{error}</p>}
    {assessment && <VehicleEvidenceAssessment assessment={assessment} assertions={assessment.listing.assertions}
      unresolvedFields={assessment.unresolved_fields} vehicleId={vehicleId} />}
  </section>;
}
