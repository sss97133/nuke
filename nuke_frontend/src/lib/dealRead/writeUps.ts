/**
 * Which text a comp's claims are read from.
 *
 * `vehicles.description` is a ~480-character summary BY DESIGN
 * (normalizeDescriptionSummary in batParser.ts). The full BaT write-up lives in
 * `extraction_metadata` rows with field_name = 'raw_listing_description'
 * (59,776 of 59,785 BaT vehicles, measured 2026-09-27; p50 2,600 chars). The
 * deal read takes the latest raw row per vehicle, as VehicleDescriptionCard
 * does, and falls back to the summary only when no raw row exists — and it
 * says which one it read.
 */

export type WriteUpSource = 'raw_listing_description' | 'vehicles.description';

export interface RawWriteUpRow {
  vehicle_id: string | null;
  field_value: string | null;
  extracted_at: string | null;
  source_url: string | null;
}

export interface WriteUp {
  text: string;
  source: WriteUpSource;
  extractedAt: string | null;
}

/** Latest non-empty raw write-up per vehicle; the summary where there is none. */
export function pickWriteUps(ids: string[], raw: RawWriteUpRow[], summaries: Map<string, string | null>): Map<string, WriteUp> {
  const latest = new Map<string, RawWriteUpRow>();
  for (const r of raw) {
    if (!r.vehicle_id || !r.field_value || !r.field_value.trim()) continue;
    const prev = latest.get(r.vehicle_id);
    if (!prev || (r.extracted_at ?? '') > (prev.extracted_at ?? '')) latest.set(r.vehicle_id, r);
  }
  const out = new Map<string, WriteUp>();
  for (const id of ids) {
    const r = latest.get(id);
    if (r) {
      out.set(id, { text: r.field_value as string, source: 'raw_listing_description', extractedAt: r.extracted_at });
      continue;
    }
    const s = summaries.get(id);
    if (s && s.trim()) out.set(id, { text: s, source: 'vehicles.description', extractedAt: null });
  }
  return out;
}
