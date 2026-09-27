/**
 * useDealRead — the rows behind a deal read, straight from the database.
 *
 * Subject: one `vehicles` row that carries an asking price (a marketplace
 * listing landed through `ingest`) plus its `vehicle_observations` (the
 * listing's claims with source URL, observed_at and method).
 *
 * Comps: the cohort's Bring a Trailer lots in `vehicles` and `bat_listings`,
 * bounded by `canonical_models.year_start/year_end`, reduced to sales by the
 * sold rule in lib/dealRead/batComps.ts. Descriptions are fetched in a second
 * pass, only for the lots that pass the rule, so the first paint stays light.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  buildCompSet, type BatListingRow, type CompSet, type VehicleCompRow,
} from '../lib/dealRead/batComps';

export interface DealSubject {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  asking_price: number | null;
  price: number | null;
  sale_price: number | null;
  sale_status: string | null;
  listing_url: string | null;
  listing_source: string | null;
  source: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  mileage: number | null;
  transmission: string | null;
  engine_type: string | null;
  engine_size: string | null;
  color: string | null;
  body_style: string | null;
  title_status: string | null;
  description: string | null;
  created_at: string | null;
  updated_at: string | null;
  primary_image_url: string | null;
  status: string | null;
}

export interface DealObservation {
  id: string;
  kind: string;
  observed_at: string;
  ingested_at: string | null;
  source_url: string | null;
  source_identifier: string | null;
  content_text: string | null;
  structured_data: Record<string, unknown> | null;
  confidence: string | null;
  confidence_score: number | null;
  extraction_method: string | null;
  extraction_metadata: Record<string, unknown> | null;
}

export interface CohortBounds {
  canonical_model: string;
  year_start: number;
  year_end: number;
  source: 'canonical_models';
}

const SUBJECT_COLUMNS = [
  'id', 'year', 'make', 'model', 'trim', 'asking_price', 'price', 'sale_price', 'sale_status',
  'listing_url', 'listing_source', 'source', 'location', 'city', 'state', 'mileage', 'transmission',
  'engine_type', 'engine_size', 'color', 'body_style', 'title_status', 'description', 'created_at',
  'updated_at', 'primary_image_url', 'status',
].join(',');

const COMP_COLUMNS = [
  'id', 'year', 'make', 'model', 'trim', 'sale_price', 'sale_status', 'auction_outcome', 'sale_date',
  'listing_url', 'bat_auction_url', 'discovery_url', 'bat_sold_price', 'high_bid', 'mileage',
  'transmission', 'engine_size', 'engine_type', 'bat_listing_title', 'title', 'primary_image_url',
].join(',');

const BAT_LISTING_COLUMNS = [
  'id', 'vehicle_id', 'bat_listing_url', 'bat_listing_title', 'listing_status', 'sale_price',
  'sale_date', 'auction_end_date',
].join(',');

const PAGE = 1000;

async function fetchSubject(vehicleId: string): Promise<DealSubject | null> {
  const { data, error } = await supabase
    .from('vehicles')
    .select(SUBJECT_COLUMNS)
    .eq('id', vehicleId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as DealSubject) ?? null;
}

async function fetchObservations(vehicleId: string): Promise<DealObservation[]> {
  const { data, error } = await supabase
    .from('vehicle_observations')
    .select('id,kind,observed_at,ingested_at,source_url,source_identifier,content_text,structured_data,confidence,confidence_score,extraction_method,extraction_metadata')
    .eq('vehicle_id', vehicleId)
    .order('observed_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as DealObservation[];
}

async function fetchBounds(make: string, model: string): Promise<CohortBounds | null> {
  type Row = { canonical_model: string; year_start: number; year_end: number };
  const base = () => supabase
    .from('canonical_models')
    .select('canonical_model,year_start,year_end')
    .ilike('make', make)
    .not('year_start', 'is', null)
    .not('year_end', 'is', null)
    .order('year_start', { ascending: true })
    .limit(1);
  // the canonical name first, then the alias list ("K5" → "K5 Blazer")
  const exact = await base().ilike('canonical_model', model);
  if (exact.error) throw exact.error;
  let row = exact.data?.[0] as Row | undefined;
  if (!row) {
    const alias = await base().contains('aliases', [model]);
    if (alias.error) throw alias.error;
    row = alias.data?.[0] as Row | undefined;
  }
  return row ? { ...row, source: 'canonical_models' } : null;
}

async function fetchAllPages<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

// Exact make + listing_url only: measured under the anon role 2026-09-27, this
// shape answers in ~0.4 s where `make ilike` + a three-column URL OR took 9 s
// warm and timed out cold (anon statement_timeout is 15 s). The rows it drops
// are BaT stubs whose URL sits only in discovery_url — duplicates of lots the
// listing_url rows already carry.
async function fetchCohortVehicles(make: string, model: string, yearStart: number, yearEnd: number): Promise<VehicleCompRow[]> {
  const makes = Array.from(new Set([make, make.toUpperCase(), make.toLowerCase(), make[0].toUpperCase() + make.slice(1).toLowerCase()]));
  return fetchAllPages<VehicleCompRow>((from, to) =>
    supabase
      .from('vehicles')
      .select(COMP_COLUMNS)
      .in('make', makes)
      .ilike('model', `%${model}%`)
      .gte('year', yearStart)
      .lte('year', yearEnd)
      .is('deleted_at', null)
      .ilike('listing_url', '%bringatrailer.com%')
      .order('id')
      .range(from, to),
  );
}

async function fetchBatListings(make: string, model: string): Promise<BatListingRow[]> {
  const slugPart = `-${make}-${model}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return fetchAllPages<BatListingRow>((from, to) =>
    supabase
      .from('bat_listings')
      .select(BAT_LISTING_COLUMNS)
      .ilike('bat_listing_url', `%${slugPart}%`)
      .order('id')
      .range(from, to),
  );
}

async function fetchDescriptions(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await supabase
      .from('vehicles')
      .select('id,description')
      .in('id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string; description: string | null }>) out.set(row.id, row.description);
  }
  return out;
}

export interface DealReadData {
  subject: DealSubject | null | undefined;
  observations: DealObservation[] | undefined;
  bounds: CohortBounds | null | undefined;
  cohortVehicles: VehicleCompRow[] | undefined;
  batListings: BatListingRow[] | undefined;
  compSet: CompSet | null;
  /** true once the descriptions behind the text claims have been merged in */
  textLoaded: boolean;
  isLoading: boolean;
  error: Error | null;
}

export function useDealRead(vehicleId: string | undefined, now: Date = new Date()): DealReadData {
  const subjectQ = useQuery({
    queryKey: ['deal-read', 'subject', vehicleId],
    queryFn: () => fetchSubject(vehicleId as string),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });
  const subject = subjectQ.data;
  const make = subject?.make?.trim() ?? '';
  const model = subject?.model?.trim() ?? '';

  const observationsQ = useQuery({
    queryKey: ['deal-read', 'observations', vehicleId],
    queryFn: () => fetchObservations(vehicleId as string),
    enabled: !!vehicleId,
    staleTime: 5 * 60 * 1000,
  });

  const boundsQ = useQuery({
    queryKey: ['deal-read', 'bounds', make, model],
    queryFn: () => fetchBounds(make, model),
    enabled: !!make && !!model,
    staleTime: 60 * 60 * 1000,
  });
  const bounds = boundsQ.data;
  const modelToken = bounds?.canonical_model ?? model;

  const cohortQ = useQuery({
    queryKey: ['deal-read', 'cohort', make, modelToken, bounds?.year_start, bounds?.year_end],
    queryFn: () => fetchCohortVehicles(make, modelToken, bounds!.year_start, bounds!.year_end),
    enabled: !!bounds,
    staleTime: 10 * 60 * 1000,
  });

  const batQ = useQuery({
    queryKey: ['deal-read', 'bat_listings', make, modelToken],
    queryFn: () => fetchBatListings(make, modelToken),
    enabled: !!bounds,
    staleTime: 10 * 60 * 1000,
  });

  // First pass: the sold rule without write-ups — decides which lots need text.
  const firstPass = useMemo(() => {
    if (!bounds || !cohortQ.data || !batQ.data) return null;
    return buildCompSet(cohortQ.data, batQ.data, {
      modelToken, yearStart: bounds.year_start, yearEnd: bounds.year_end, now,
    });
  }, [bounds, cohortQ.data, batQ.data, modelToken, now]);

  const compIds = useMemo(
    () => (firstPass?.comps ?? []).map(c => c.vehicleId).filter((id): id is string => !!id).sort(),
    [firstPass],
  );

  const descQ = useQuery({
    queryKey: ['deal-read', 'descriptions', compIds],
    queryFn: () => fetchDescriptions(compIds),
    enabled: compIds.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  // Second pass: same rule, write-ups merged in for the claim features.
  const compSet = useMemo(() => {
    if (!firstPass || !bounds || !cohortQ.data || !batQ.data) return firstPass;
    if (!descQ.data) return firstPass;
    const rows = cohortQ.data.map(v => (descQ.data.has(v.id) ? { ...v, description: descQ.data.get(v.id) ?? null } : v));
    return buildCompSet(rows, batQ.data, {
      modelToken, yearStart: bounds.year_start, yearEnd: bounds.year_end, now,
    });
  }, [firstPass, bounds, cohortQ.data, batQ.data, descQ.data, modelToken, now]);

  const error = (subjectQ.error ?? observationsQ.error ?? boundsQ.error ?? cohortQ.error ?? batQ.error ?? descQ.error) as Error | null;

  return {
    subject,
    observations: observationsQ.data,
    bounds,
    cohortVehicles: cohortQ.data,
    batListings: batQ.data,
    compSet,
    textLoaded: compIds.length === 0 ? !!firstPass : !!descQ.data,
    isLoading: subjectQ.isLoading || (!!subject && (boundsQ.isLoading || cohortQ.isLoading || batQ.isLoading)),
    error,
  };
}
