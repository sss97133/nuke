import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import type { LiveAuction } from './useMarketPulse';

export type LotInspection = 'auction' | 'vehicle' | 'sources';
export interface VehicleSpec {
  field: string;
  label?: string;
  value?: unknown;
  reported_value?: unknown;
  rooted?: boolean;
  reported_conflict?: boolean;
  source_observation_id?: string | null;
  reported_source?: string | null;
  inline_source?: string | null;
}
export interface RowFact {
  field: string;
  label: string;
  value: string;
  conflict: boolean;
  observationId: string | null;
  reason: string;
}
export interface MarketRowDetails {
  id: string;
  listingUrl: string;
  location: string | null;
  locationSource: string | null;
  bidCount: number | null;
  watchers: number | null;
  lastBidAt: string | null;
  recordedAt: string | null;
  currentBid: number | null;
}

export function vehicleIdentity(a: Pick<LiveAuction, 'year' | 'make' | 'model'>): string {
  return [a.year, a.make === 'NO MAKE' ? null : a.make, a.model].filter(Boolean).join(' ') || 'Vehicle identity unrecorded';
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const result = String(value).trim();
  return result && !/^(unknown|null|undefined|n\/a|none)$/i.test(result) ? result : null;
};
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Display policy v1. Evidence conflicts, then powertrain, body and appearance.
 * This selects attributed vehicle reports; it does not infer rarity, installation,
 * sale-time configuration, mileage units or features from a marketing headline.
 */
export function selectRowFacts(specs: VehicleSpec[], identity: string): RowFact[] {
  const priority = ['engine_type', 'engine_size', 'transmission', 'drivetrain', 'body_style', 'color', 'interior_color'];
  const labels: Record<string, string> = { engine_type: 'Engine', engine_size: 'Listed engine', transmission: 'Transmission',
    drivetrain: 'Drive', body_style: 'Body', color: 'Color', interior_color: 'Interior' };
  const candidates = specs.filter(s => priority.includes(s.field))
    .filter(s => s.rooted || (s.source_observation_id && (s.reported_value != null || s.reported_conflict)))
    .sort((a, b) => Number(!!b.reported_conflict) - Number(!!a.reported_conflict)
      || priority.indexOf(a.field) - priority.indexOf(b.field) || a.field.localeCompare(b.field));
  const seen = new Set<string>();
  const result: RowFact[] = [];
  for (const s of candidates) {
    const conflict = s.reported_conflict === true;
    const value = text(s.reported_value) ?? text(s.value) ?? (conflict ? `${labels[s.field]} unrecorded` : null);
    if (!value || value.length > 120) continue;
    const group = s.field.startsWith('engine_') ? 'engine' : s.field;
    if (seen.has(group) || (!conflict && (` ${normalized(identity)} `).includes(` ${normalized(value)} `))) continue;
    if (!conflict && result.some(f => normalized(f.value) === normalized(value))) continue;
    seen.add(group);
    result.push({ field: s.field, label: labels[s.field], value, conflict, observationId: s.source_observation_id ?? null,
      reason: conflict ? 'A disagreement takes priority over descriptive specifications.'
        : 'Selected from attributed vehicle reports: powertrain, then body and appearance; repeated identity is omitted.' });
    if (result.length === 3) break;
  }
  return result;
}

const lotUrl = (url: unknown) => typeof url === 'string' && /^https:\/\/bringatrailer\.com\/listing\/[^/?#]+\/?$/.test(url)
  ? url.replace(/\/$/, '') : null;
const positiveCount = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
const timestamp = (s: unknown) => typeof s === 'string' && Number.isFinite(Date.parse(s)) && Date.parse(s) <= Date.now() ? s : null;

/** Public, current-episode metadata for one bounded board page. No log scans. */
export async function readMarketRowDetails(lots: Pick<LiveAuction, 'id' | 'listingUrl'>[]): Promise<Map<string, MarketRowDetails>> {
  const input = lots.slice(0, 24);
  const expected = new Map(input.map(a => [a.id, lotUrl(a.listingUrl)]));
  if (!input.length) return new Map();
  const parents = await supabase.from('vehicles')
    .select('id,listing_url,state,zip_code,listing_location_source')
    .in('id', input.map(a => a.id)).eq('is_public', true).is('deleted_at', null)
    .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item').limit(24);
  if (parents.error) throw parents.error;
  const eligible = (parents.data ?? []).filter(p => expected.get(p.id) && lotUrl(p.listing_url) === expected.get(p.id));
  const result = new Map<string, MarketRowDetails>(eligible.map(p => [p.id, {
    id: p.id, listingUrl: p.listing_url,
    // These are listing-supplied locations, never registration, GPS or inferred venue locations.
    location: ['bat', 'bat_snapshot_parser'].includes(p.listing_location_source ?? '')
      ? [text(p.state), text(p.zip_code)].filter(Boolean).join(' · ') || null : null,
    locationSource: p.listing_location_source, bidCount: null, watchers: null, lastBidAt: null, recordedAt: null, currentBid: null,
  }]));
  if (!eligible.length) return result;
  const events = await supabase.from('vehicle_events')
    .select('id,vehicle_id,source_url,event_status,current_price,bid_count,watcher_count,updated_at,last_bid_at:metadata->live_stream->>last_bid_at,vehicles!inner(id)')
    .in('vehicle_id', eligible.map(p => p.id))
    .in('source_url', eligible.flatMap(p => [lotUrl(p.listing_url)!, `${lotUrl(p.listing_url)}/`]))
    .in('source_platform', ['bat', 'bringatrailer'])
    .eq('vehicles.is_public', true).is('vehicles.deleted_at', null)
    .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item', { referencedTable: 'vehicles' }).limit(49);
  // A metrics read failure must not erase already eligible location/specification context.
  if (events.error || !events.data || events.data.length >= 49) return result;
  for (const [id, detail] of result) {
    const matches = events.data.filter(e => e.vehicle_id === id && lotUrl(e.source_url) === expected.get(id));
    // Duplicate episode states need an owner resolution; never pick a high or latest value in the browser.
    if (matches.length !== 1) continue;
    const e = matches[0];
    result.set(id, { ...detail, bidCount: positiveCount(e.bid_count), watchers: positiveCount(e.watcher_count),
      lastBidAt: timestamp(e.last_bid_at), recordedAt: timestamp(e.updated_at),
      currentBid: ['active', 'live'].includes(e.event_status) && typeof e.current_price === 'number'
        && Number.isFinite(e.current_price) && e.current_price > 0 ? e.current_price : null });
  }
  return result;
}

export function useMarketRowDetails(lots: Pick<LiveAuction, 'id' | 'listingUrl'>[]) {
  return useQuery({ queryKey: ['market-row-details', lots.map(a => `${a.id}:${a.listingUrl}`).join('|')],
    queryFn: () => readMarketRowDetails(lots), enabled: lots.length > 0,
    staleTime: 30_000, refetchInterval: 60_000, retry: 1 });
}

export function useMarketRowSpecs(vehicleId: string, enabled: boolean) {
  return useQuery({ queryKey: ['market-row-specs', vehicleId], queryFn: async () => {
    const { data, error } = await supabase.rpc('get_vehicle_specs', { p_vehicle_id: vehicleId });
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as VehicleSpec[];
  }, enabled, staleTime: 5 * 60_000, retry: false });
}
