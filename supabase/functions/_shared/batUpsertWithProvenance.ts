/**
 * _shared/batUpsertWithProvenance.ts — Tetris Write Layer
 *
 * Every vehicle field write goes through this module:
 * 1. GAP FILL: existing is NULL → write value + extraction_metadata receipt + *_source column
 * 2. CONFIRMATION: existing matches new → add verification receipt (no overwrite)
 * 3. CONFLICT: existing differs from new → quarantine (no overwrite)
 *
 * This prevents data regression and creates full provenance tracking.
 *
 * Version: 1.0.0
 */

export const TETRIS_VERSION = "tetris:1.0.0";

// Fields that have corresponding *_source columns on vehicles
const SOURCE_COLUMN_MAP: Record<string, string> = {
  make: "make_source",
  model: "model_source",
  year: "year_source",
  vin: "vin_source",
  mileage: "mileage_source",
  color: "color_source",
  exterior_color: "color_source",
  interior_color: "color_source", // shared source column
  transmission: "transmission_source",
  engine_size: "engine_source",
  drivetrain: "drivetrain", // no source column for drivetrain
  description: "description_source",
  series: "series_source",
  trim: "trim_source",
  msrp: "msrp_source",
  listing_location: "listing_location_source",
  platform: "platform_source",
};

// Fields that should use exact numeric comparison
const NUMERIC_FIELDS = new Set([
  "year", "mileage", "sale_price", "high_bid", "bat_bids", "bat_comments",
  "bat_views", "bat_watchers", "bid_count", "comment_count", "view_count", "watcher_count",
]);

export interface ProvenanceMetadata {
  extraction_version: string;
  extraction_method: string; // 'regex' | 'table_parse' | 'html_match' | 'url_slug' | 'json_ld' | etc.
  source_url: string;
  confidence_score: number; // 0-1
  source_signal: string; // 'stats_table' | 'essentials_block' | 'url_slug' | 'title' | etc.
}

export interface UpsertResult {
  action: "gap_fill" | "confirmation" | "conflict" | "skipped";
  field: string;
  value: any;
  existing_value?: any;
}

interface TetrisContext {
  supabase: any;
  vehicleId: string;
  listingUrl: string;
  extractionVersion: string;
}

function normalizeForComparison(val: any): string {
  if (val === null || val === undefined) return "";
  return String(val).trim().toLowerCase();
}

function valuesMatch(existing: any, proposed: any, field: string): boolean {
  if (existing === null || existing === undefined) return false;
  if (proposed === null || proposed === undefined) return false;

  if (NUMERIC_FIELDS.has(field)) {
    const a = Number(existing);
    const b = Number(proposed);
    if (Number.isFinite(a) && Number.isFinite(b)) return a === b;
  }

  return normalizeForComparison(existing) === normalizeForComparison(proposed);
}

/** Write an extraction_metadata receipt row */
async function writeReceipt(
  ctx: TetrisContext,
  field: string,
  value: any,
  metadata: ProvenanceMetadata,
  validationStatus: string = "unvalidated",
): Promise<void> {
  try {
    const v = String(value ?? "").trim();
    if (!v) return;

    // Deduplicate: skip if last row for this (vehicle, field, source_url) matches exactly
    const { data: lastRow } = await ctx.supabase
      .from("extraction_metadata")
      .select("field_value")
      .eq("vehicle_id", ctx.vehicleId)
      .eq("field_name", field)
      .eq("source_url", ctx.listingUrl)
      .order("extracted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (lastRow && String(lastRow.field_value || "").trim() === v) return;

    await ctx.supabase.from("extraction_metadata").insert({
      vehicle_id: ctx.vehicleId,
      field_name: field,
      field_value: v,
      extraction_method: metadata.extraction_method,
      scraper_version: metadata.extraction_version,
      source_url: ctx.listingUrl,
      confidence_score: Math.max(0, Math.min(1, Number(metadata.confidence_score) || 0)),
      validation_status: validationStatus,
      extracted_at: new Date().toISOString(),
      raw_extraction_data: {
        source_signal: metadata.source_signal,
        tetris_version: TETRIS_VERSION,
      },
    });
  } catch (e: any) {
    console.warn(`[tetris] extraction_metadata insert failed for ${field}: ${e?.message}`);
  }
}

/** Write a quarantine row for conflicting values */
async function quarantine(
  ctx: TetrisContext,
  field: string,
  existingValue: any,
  proposedValue: any,
  metadata: ProvenanceMetadata,
  issues: string[] = [],
): Promise<void> {
  try {
    await ctx.supabase.from("bat_quarantine").insert({
      vehicle_id: ctx.vehicleId,
      listing_url: ctx.listingUrl,
      field_name: field,
      existing_value: String(existingValue ?? ""),
      proposed_value: String(proposedValue ?? ""),
      extraction_version: metadata.extraction_version,
      quality_score: metadata.confidence_score,
      issues: issues.length > 0 ? issues : [`conflict: existing="${existingValue}" vs proposed="${proposedValue}"`],
    });
  } catch (e: any) {
    console.warn(`[tetris] quarantine insert failed for ${field}: ${e?.message}`);
  }
}

/**
 * Upsert a single field with full provenance tracking.
 *
 * Rules:
 * 1. If existing is NULL → GAP FILL: write value + receipt + source column
 * 2. If existing matches proposed → CONFIRMATION: add verification receipt only
 * 3. If existing differs → CONFLICT: quarantine, don't overwrite
 */
export async function upsertFieldWithProvenance(
  ctx: TetrisContext,
  field: string,
  proposedValue: any,
  existingValue: any,
  metadata: ProvenanceMetadata,
): Promise<UpsertResult> {
  // Skip null/undefined proposed values
  if (proposedValue === null || proposedValue === undefined || String(proposedValue).trim() === "") {
    return { action: "skipped", field, value: null };
  }

  const existingIsEmpty = existingValue === null || existingValue === undefined || String(existingValue).trim() === "";

  if (existingIsEmpty) {
    // GAP FILL
    await writeReceipt(ctx, field, proposedValue, metadata, "unvalidated");
    return { action: "gap_fill", field, value: proposedValue };
  }

  if (valuesMatch(existingValue, proposedValue, field)) {
    // CONFIRMATION — don't overwrite, just add verification receipt
    await writeReceipt(ctx, field, proposedValue, metadata, "confirmed");
    return { action: "confirmation", field, value: proposedValue, existing_value: existingValue };
  }

  // CONFLICT — quarantine the disagreement
  await quarantine(ctx, field, existingValue, proposedValue, metadata);
  await writeReceipt(ctx, field, proposedValue, metadata, "conflicting");
  return { action: "conflict", field, value: proposedValue, existing_value: existingValue };
}

/**
 * Batch upsert multiple fields for a vehicle.
 *
 * Returns the update payload (only gap-filled fields) ready for supabase.update().
 * Confirmations and conflicts are handled via side effects (receipts + quarantine).
 */
export async function batchUpsertWithProvenance(
  supabase: any,
  vehicleId: string,
  listingUrl: string,
  extractionVersion: string,
  existingVehicle: Record<string, any>,
  proposedFields: Record<string, any>,
  metadataPerField: Record<string, ProvenanceMetadata>,
  defaultMetadata: ProvenanceMetadata,
): Promise<{
  updatePayload: Record<string, any>;
  results: UpsertResult[];
  stats: { gap_fills: number; confirmations: number; conflicts: number; skipped: number };
}> {
  const ctx: TetrisContext = { supabase, vehicleId, listingUrl, extractionVersion };

  const updatePayload: Record<string, any> = {};
  const results: UpsertResult[] = [];
  const stats = { gap_fills: 0, confirmations: 0, conflicts: 0, skipped: 0 };

  for (const [field, proposedValue] of Object.entries(proposedFields)) {
    const metadata = metadataPerField[field] || defaultMetadata;
    const existingValue = existingVehicle[field] ?? null;

    const result = await upsertFieldWithProvenance(ctx, field, proposedValue, existingValue, metadata);
    results.push(result);

    switch (result.action) {
      case "gap_fill":
        updatePayload[field] = proposedValue;
        // Also set *_source column if it exists
        const sourceCol = SOURCE_COLUMN_MAP[field];
        if (sourceCol && sourceCol !== field) {
          updatePayload[sourceCol] = metadata.extraction_version;
        }
        stats.gap_fills++;
        break;
      case "confirmation":
        stats.confirmations++;
        break;
      case "conflict":
        stats.conflicts++;
        break;
      case "skipped":
        stats.skipped++;
        break;
    }
  }

  return { updatePayload, results, stats };
}

/**
 * Quarantine an entire record (not field-level).
 * Used when quality gate rejects the whole extraction.
 */
export async function quarantineRecord(
  supabase: any,
  vehicleId: string | null,
  listingUrl: string,
  extractionVersion: string,
  qualityScore: number,
  issues: string[],
): Promise<void> {
  try {
    await supabase.from("bat_quarantine").insert({
      vehicle_id: vehicleId,
      listing_url: listingUrl,
      field_name: null, // whole-record rejection
      existing_value: null,
      proposed_value: null,
      extraction_version: extractionVersion,
      quality_score: qualityScore,
      issues,
    });
  } catch (e: any) {
    console.warn(`[tetris] quarantine record insert failed: ${e?.message}`);
  }
}
