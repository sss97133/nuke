import { supabase } from '../../lib/supabase';

// The owner's on-demand photo read of one listing (api-v1-vision /listing, admins only; it writes one condition
// observation through ingest-observation). Owner, 2026-10-15: analyze a listing only when someone asks, "so we don't
// have to analyze every single new listing". YONO reads first at no model fee; otherwise the admin's own connected
// provider pays (about $0.015 a photo on claude-sonnet by the 10-15 estimate).
export type FlagCount = { flag: string; photos: number };
export type ListingRead = {
  observation_id: string; photos_requested: number; photos_analyzed: number;
  analyzer: string | null; cost_bearer: string | null; cost_usd: number | null;
  condition_score: number | null; condition_scores_counted: number; zones_seen: string[];
  damage_flags: FlagCount[]; modification_flags: FlagCount[]; interior_quality: number | null;
};

export async function requestListingRead(vehicleId: string): Promise<ListingRead> {
  const { data, error } = await supabase.functions.invoke('api-v1-vision/listing', { body: { vehicle_id: vehicleId } });
  if (error) {
    // The route says why it refused: not an admin (403), the daily cap (429), no analyzer reachable (503).
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.hint ? `${body.error}: ${body.hint}` : body?.error ?? error.message);
  }
  return data as ListingRead;
}

// The read as the card says it: a 1-5 score (5 concours, 1 project) from how many photos, then what the photos showed.
export function readLines(r: ListingRead): string[] {
  const flags = (list: FlagCount[]) => list.slice(0, 4).map(f => `${f.flag.replace(/_/g, ' ')} (${f.photos})`).join(', ');
  const by = r.analyzer ? ` by ${r.analyzer}` : '';
  const lines = [r.condition_score == null
    ? `photos: ${r.photos_analyzed} of ${r.photos_requested} read${by}, condition not scored`
    : `photos: condition ${r.condition_score} of 5, ${r.photos_analyzed} of ${r.photos_requested} read${by}`];
  lines.push(r.damage_flags.length ? `damage seen: ${flags(r.damage_flags)}` : 'no damage flagged');
  if (r.modification_flags.length) lines.push(`changes seen: ${flags(r.modification_flags)}`);
  return lines;
}
