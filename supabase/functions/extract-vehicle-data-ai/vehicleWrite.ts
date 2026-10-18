/**
 * The vehicles write of extract-vehicle-data-ai: find the vehicle, then gap-fill it or create it.
 *
 * It lives apart from the request handler so a test can hand it a stubbed client and read what it writes
 * and what it returns. The handler returns a failed write to its caller as an error response. A write
 * that creates nothing never answers success with no vehicle: a refused insert, an insert that returns
 * no row, and a client that throws all come back as { ok: false }.
 */
import { normalizeVehicleFields } from '../_shared/normalizeVehicle.ts'
import { listingPriceColumns } from './priceColumns.ts'
import { insertRefusal } from './insertRefusal.ts'

/** The slice of the supabase-js client this write uses. */
export interface VehicleWriteClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any
}

export interface VehicleWriteLog {
  log(message: string): void
  error(message: string): void
}

export interface VehicleWriteInput {
  /** The extraction. normalizeVehicleFields cleans it in place, and the caller's observation write reads the cleaned object. */
  // deno-lint-ignore no-explicit-any
  normalized: Record<string, any>
  url: string
  /** The `source` the caller sent, if any. */
  source?: string | null
  /** The slug derived from the URL's hostname. */
  sourceSlug?: string | null
}

export type VehicleWriteResult =
  | { ok: true; vehicleId: string; action: 'created' | 'gap_filled'; filled: string[]; gapFillError: string | null }
  | { ok: false; status: number; body: Record<string, unknown> }

export async function writeVehicle(
  client: VehicleWriteClient,
  { normalized, url, source, sourceSlug }: VehicleWriteInput,
  log: VehicleWriteLog = console,
): Promise<VehicleWriteResult> {
  try {
    // Check for existing vehicle by URL or VIN
    let existing: { id: string } | null = null
    if (normalized.vin && normalized.vin.length >= 11) {
      const { data } = await client
        .from('vehicles')
        .select('id')
        .eq('vin', normalized.vin)
        .limit(1)
        .maybeSingle()
      existing = data
    }
    if (!existing && url) {
      const { data } = await client
        .from('vehicles')
        .select('id')
        .eq('discovery_url', url)
        .limit(1)
        .maybeSingle()
      existing = data
    }

    // Normalize make/model/transmission/drivetrain/VIN via shared canonical layer
    normalizeVehicleFields(normalized)

    // deno-lint-ignore no-explicit-any
    const vehiclePayload: Record<string, any> = {
      year: normalized.year,
      make: normalized.make,
      model: normalized.model || null,
      series: normalized.series || null,
      trim: normalized.trim || null,
      vin: normalized.vin || null,
      mileage: normalized.mileage || null,
      color: normalized.exterior_color || normalized.color || null,
      interior_color: normalized.interior_color || null,
      transmission: normalized.transmission || null,
      drivetrain: normalized.drivetrain || null,
      engine_type: normalized.engine || null,
      body_style: normalized.body_style || null,
      // A price on an arbitrary page is an ask: asking_price only. This extractor never writes sale_price;
      // sold_price stays in the extraction and its observation. See priceColumns.ts.
      ...listingPriceColumns(normalized),
      description: normalized.description?.slice(0, 5000) || null,
      discovery_url: url,
      listing_url: url,
      // Provenance: hostname-derived slug (e.g. 'craigslist', 'hemmings') — never 'unknown'
      source: sourceSlug || source || 'ai_extraction',
      discovery_source: source || sourceSlug || 'ai_extraction',
      profile_origin: source || 'ai_extraction',
      // Scraped page = third-party testimony, not an owner claim
      // (matches scripts/import-fb-saved.mjs; vehicles_entry_type_check allows:
      //  owner_claim | contributor_data | title_verified | disputed)
      entry_type: 'contributor_data',
      // 1.3 (2026-07-02): gap-fill-only updates, domain-derived observation
      // platform, no-DELETE image dedupe (DNA audit §IV)
      extractor_version: 'extract-vehicle-data-ai:1.3',
      status: 'active',
    }

    if (existing) {
      const vehicleId = existing.id
      // GAP-FILL ONLY (Tetris discipline — _shared/batUpsertWithProvenance.ts):
      // fetch the existing row and fill only columns that are currently NULL.
      // Re-extractions never overwrite existing values. (2026-07-02 DNA audit:
      // the old loop checked only the NEW value for null, so it clobbered
      // existing columns despite its own comment.)
      // entry_type is set at record creation only — never downgrade an existing
      // owner_claim/title_verified vehicle to contributor_data on re-extraction.
      // sale_price is never gap-filled: this extractor does not write a sale.
      const { data: existingRow } = await client
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .maybeSingle()
      // deno-lint-ignore no-explicit-any
      const updates: Record<string, any> = {}
      if (existingRow) {
        for (const [key, val] of Object.entries(vehiclePayload)) {
          if (val === null || key === 'discovery_url' || key === 'status' || key === 'entry_type' || key === 'sale_price') continue
          if (existingRow[key] === null || existingRow[key] === undefined) {
            updates[key] = val
          }
        }
      }
      const attempted = Object.keys(updates)
      let gapFillError: string | null = null
      if (attempted.length > 0) {
        try {
          const { error } = await client.from('vehicles').update(updates).eq('id', vehicleId)
          if (error) gapFillError = error.message || 'the update failed without a message'
        } catch (e) {
          gapFillError = e instanceof Error ? e.message : String(e)
        }
      }
      if (gapFillError) {
        log.error(`[extract-vehicle-data-ai] Gap-fill failed for ${vehicleId}: ${gapFillError}`)
      } else {
        log.log(`[extract-vehicle-data-ai] Gap-filled ${attempted.length} NULL fields on existing vehicle: ${vehicleId}`)
      }
      return { ok: true, vehicleId, action: 'gap_filled', filled: gapFillError ? [] : attempted, gapFillError }
    }

    const { data: inserted, error: insertErr } = await client
      .from('vehicles')
      .insert(vehiclePayload)
      .select('id')
      .maybeSingle()
    if (insertErr) {
      log.error(`[extract-vehicle-data-ai] Vehicle insert failed: ${insertErr.message}`)
      const refusal = insertRefusal(insertErr, normalized, url)
      return { ok: false, status: refusal.status, body: refusal.body }
    }
    if (!inserted?.id) {
      log.error('[extract-vehicle-data-ai] Vehicle insert failed: the insert returned no row and no error')
      const refusal = insertRefusal({ message: 'the insert returned no row and no error' }, normalized, url)
      return { ok: false, status: refusal.status, body: refusal.body }
    }
    log.log(`[extract-vehicle-data-ai] Created vehicle: ${inserted.id}`)
    return { ok: true, vehicleId: inserted.id, action: 'created', filled: [], gapFillError: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    log.error(`[extract-vehicle-data-ai] Vehicle write threw: ${message}`)
    const refusal = insertRefusal({ message: `the write threw: ${message}` }, normalized, url)
    return { ok: false, status: 500, body: refusal.body }
  }
}
