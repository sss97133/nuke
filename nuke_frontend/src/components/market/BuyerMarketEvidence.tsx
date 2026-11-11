import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PrefetchLink } from '../PrefetchLink';
import { comparePriceToSourceSales } from '../../lib/dealRead/batComps';
import type { ValuationResult } from '../../pages/Valuation';
import SourceSaleDistribution from './SourceSaleDistribution';
import { retryColdTimeout } from '../../pages/market/useRecordedSales';

export function buyerComparisonUrl(year: number | null, make: string, model: string, vehicleId?: string | null) {
  const params = new URLSearchParams({ make, model, currency: 'USD' });
  if (year != null) params.set('year', String(year));
  if (vehicleId) params.set('vehicle_id', vehicleId);
  return `/valuation?${params}`;
}

/** Read only, on inspection. No compute/batch valuation or estimate write on arrival. */
export default function BuyerMarketEvidence({ year, make, model, vehicleId }: {
  year: number | null; make: string; model: string; vehicleId?: string | null;
}) {
  const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ['buyer-sale-evidence', year, make, model, vehicleId],
    enabled: !!make && !!model,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('valuation_by_ymm', {
        p_year: year, p_make: make, p_model: model, p_currency: 'USD', p_price: null,
        p_subject_vehicle_id: vehicleId ?? null, p_knowledge_mode: 'retrospective',
      });
      if (error) throw error;
      if (data?.error || !data?.receipt?.cohort?.complete || !Array.isArray(data.receipt.eligible)
        || data.receipt.currency !== 'USD' || data.receipt.knowledge_mode !== 'retrospective'
        || data.query?.year !== year || data.query?.make !== make || data.query?.model !== model) throw new Error('Unsupported comparison receipt');
      return data as ValuationResult;
    }, staleTime: 5 * 60_000, retry: retryColdTimeout, refetchOnWindowFocus: false });
  const receipt = query.data?.receipt;
  const qualified = receipt ? comparePriceToSourceSales(receipt.eligible, {
    cohort: receipt.cohort, subject: { amount: null, currency: 'USD', priceBasis: 'published_bid_excluding_fees', vehicleId },
    eventFrom: receipt.event_from, eventBefore: receipt.event_before, evidenceAsOf: receipt.evidence_as_of,
    computedAt: receipt.computed_at, knowledgeMode: receipt.knowledge_mode, minimumSales: receipt.minimum_sales,
  }) : null;
  const labels = Object.fromEntries((query.data?.comparables ?? []).map(c => [c.bat_listing_url, [c.year, c.make, c.model].filter(Boolean).join(' ')]));
  return <section aria-label="Buyer market evidence" className="buyer-market-evidence">
    <h3>Market evidence for this acquisition</h3>
    <p>Recorded sale amounts over time provide context for a bid. Build, mileage and condition still need comparison; a hammer-price forecast is not established here.</p>
    {query.isPending && <p role="status">Reading qualified sale records…</p>}
    {query.isError && <p role="status">Sale evidence could not be read{(query.error as { code?: string })?.code === '57014' ? ' within the reader’s time limit' : ''}. <button type="button" onClick={() => void query.refetch()}>Retry sale evidence</button></p>}
    {receipt && qualified && (qualified.eligible.length ? <SourceSaleDistribution
      key={receipt.cohort.key} initialView="timeline" sales={qualified.eligible} currency={receipt.currency}
      label={receipt.cohort.label} basis={receipt.cohort.basis} memberRows={receipt.coverage.member_rows}
      minimumSales={receipt.minimum_sales} yearRestricted={year != null} modelRestricted
      eventFrom={receipt.event_from} eventBefore={receipt.event_before} evidenceAsOf={receipt.evidence_as_of}
      knowledgeMode={receipt.knowledge_mode} recordedLabels={labels}
      summary={qualified.eligible.length === receipt.eligible.length ? query.data!.stats : { median: null, p10: null, p90: null }} comparison={null}
      page={page} onPageChange={setPage} /> : <p>No qualified sales in this recorded year/model comparison. Missing evidence does not establish a low value or low demand.</p>)}
    <PrefetchLink to={buyerComparisonUrl(year, make, model, vehicleId)}>Compare sale records and an amount reference in Nuke →</PrefetchLink>
    <p>Before bidding: confirm VIN, specification, mileage, service history and condition; establish buyer fees, tax, transport and repair costs. The catalog alone does not establish an all-in acquisition cost.</p>
  </section>;
}
