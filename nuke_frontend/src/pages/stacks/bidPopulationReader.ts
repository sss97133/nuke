import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { decodeStudy, makeStudy, type BidLot, type StudyBid, type StudyDataset } from './bidMeasurements';

export interface PopulationRequest { make: string | null; model: string | null; year: number }
export const POPULATION_LIMIT = 120;
export const POPULATION_LOT_SELECT = 'id,vehicle_id,source,source_url,auction_end_date,total_bids,winning_bid,winning_bidder_external_identity_id,vehicles!inner(id,year,make,model,normalized_model)';
export const POPULATION_BID_SELECT = 'id,auction_event_id,vehicle_id,source_url,posted_at,created_at,bid_amount,external_identity_id,bat_comment_id,author_username,vehicles!inner(id)';

/** Bounded public episodes, then complete keyed bid logs. No registry grants or protected metadata. */
export async function readBidPopulation(request: PopulationRequest, signal?: AbortSignal): Promise<StudyDataset> {
  if (!Number.isInteger(request.year) || request.year < 2014 || request.year > new Date().getUTCFullYear()) throw new Error('Choose a supported bid calendar year.');
  const abort = signal ?? new AbortController().signal;
  // Close selection extends by 14 days to retain sequences with bids crossing New Year.
  const from = new Date(Date.UTC(request.year, 0, 1)).toISOString();
  const end = new Date(Math.min(Date.UTC(request.year + 1, 0, 15), Date.now())).toISOString();
  let query = supabase.from('auction_events').select(POPULATION_LOT_SELECT)
    .in('source', ['bat', 'bringatrailer']).eq('outcome', 'sold')
    .gte('auction_end_date', from).lt('auction_end_date', end)
    .eq('vehicles.is_public', true).is('vehicles.deleted_at', null)
    .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item', { referencedTable: 'vehicles' });
  if (request.make) query = query.in('vehicles.make', [...new Set([request.make, request.make.toLowerCase(), request.make.toUpperCase()])]);
  if (request.model) query = query.eq('vehicles.normalized_model', request.model);
  const result = await query.order('auction_end_date', { ascending: false }).order('id').limit(POPULATION_LIMIT + 1).abortSignal(abort);
  if (result.error || !Array.isArray(result.data)) throw new Error('The requested public auction population could not be read.');
  const candidates = (result.data as unknown as BidLot[]).slice(0, POPULATION_LIMIT);
  const bids: StudyBid[] = [];
  for (let i = 0; i < candidates.length; i += 40) {
    const ids = candidates.slice(i, i + 40).map(l => l.id); let after: string | null = null, complete = false;
    for (let page = 0; page < 8; page++) {
      let read = supabase.from('auction_comments').select(POPULATION_BID_SELECT)
        .in('auction_event_id', ids).eq('comment_type', 'bid').gt('bid_amount', 0)
        .eq('vehicles.is_public', true).is('vehicles.deleted_at', null)
        .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item', { referencedTable: 'vehicles' })
        .order('id').limit(1000).abortSignal(abort);
      if (after) read = read.gt('id', after);
      const rows = await read;
      if (rows.error || !Array.isArray(rows.data)) throw new Error('The public bid sequences could not be read completely.');
      if (rows.data.length === 0) { complete = true; break; }
      for (const raw of rows.data as unknown as StudyBid[]) {
        if (!raw.id || (after && raw.id <= after)) throw new Error('Bid pagination did not preserve the read boundary.');
        bids.push(raw); after = raw.id;
      }
    }
    if (!complete) throw new Error('This population exceeds the bounded bid read. Narrow the scope.');
  }
  return makeStudy(candidates, bids, new Date().toISOString(),
    `Up to ${POPULATION_LIMIT} most recently closed public sold BaT episodes matching the requested source make/model labels; close window ${from} through ${end}. Bid calendar-year selection is applied after forming increments.`, result.data.length > POPULATION_LIMIT);
}
function validateDataset(value: unknown): StudyDataset {
  const data = value as StudyDataset;
  if (!data || data.contract !== 1 || !Array.isArray(data.lots) || !Array.isArray(data.exclusions) || !data.readAt || !data.method) throw new Error('The retained bid study has an invalid contract.');
  return data;
}
export function useBidStudy() {
  return useQuery({ queryKey: ['stacks-bid-study', 1], queryFn: async ({ signal }) => {
    const response = await fetch('/stacks/bid-study-v1.json', { signal });
    if (!response.ok) throw new Error('The retained bid study could not be loaded.');
    return validateDataset(decodeStudy(await response.json()));
  }, staleTime: Infinity, retry: 1 });
}
export function useBidPopulation(request: PopulationRequest | null) {
  return useQuery({ queryKey: ['stacks-bid-population', request?.make, request?.model, request?.year],
    queryFn: ({ signal }) => readBidPopulation(request!, signal), enabled: Boolean(request), staleTime: 300_000, retry: false });
}
