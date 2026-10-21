/**
 * Ledger-first reads for the advisor: live vehicles only, consensus → canonical →
 * observations for specs, citations from supporting observation ids.
 */
import {
  citationFromObservation,
  emptyCitation,
  type Citation,
  type ConfidenceBasis,
} from "./evidence.ts";
import { canonicalListingUrl } from "./variants.ts";

// deno-lint-ignore no-explicit-any
export type AdvisorDb = any;

/** Platforms whose "sold" rows are asking prices, not hammers. */
export const ASK_ONLY_PLATFORMS = new Set([
  "craigslist",
  "facebook_marketplace",
  "facebook",
  "fb_marketplace",
  "ksl",
  "conceptcarz",
  "unknown",
  "",
]);

const ASK_URL_RE =
  /craigslist\.org|facebook\.com\/marketplace|marketplace\.facebook|ksl\.com|conceptcarz\.com/i;

export function isAskOnlyPlatform(platform: string | null | undefined, url?: string | null): boolean {
  const p = String(platform || "").toLowerCase().trim();
  if (ASK_ONLY_PLATFORMS.has(p)) return true;
  if (url && ASK_URL_RE.test(url)) return true;
  return false;
}

const LIVE_VEHICLE_COLS =
  "id, year, make, model, trim, vin, sale_price, mileage, primary_image_url, " +
  "listing_url, bat_auction_url, nuke_estimate, nuke_estimate_confidence, location, " +
  "auction_source, canonical_platform, status, body_style, canonical_body_style, " +
  "transmission, transmission_type, transmission_speeds, transmission_model, " +
  "engine_type, drivetrain, color, interior_color, series, engine_displacement, " +
  "description, city, state, country, image_count, observation_count, " +
  "listing_title, created_at, updated_at, deleted_at, merged_into_vehicle_id";

export type LiveVehicle = Record<string, unknown>;

/** Follow merged_into_vehicle_id to the survivor; skip soft-deleted leaves. */
export async function resolveLiveVehicle(
  sb: AdvisorDb,
  assetId: string,
  selectCols: string = LIVE_VEHICLE_COLS,
): Promise<{ vehicle: LiveVehicle | null; resolved_id: string | null; followed_merge: boolean }> {
  let current = assetId;
  let followed = false;
  for (let hop = 0; hop < 6; hop++) {
    const { data } = await sb.from("vehicles").select(selectCols).eq("id", current).maybeSingle();
    if (!data) return { vehicle: null, resolved_id: null, followed_merge: followed };
    const mergedInto = data.merged_into_vehicle_id
      ? String(data.merged_into_vehicle_id)
      : null;
    if (mergedInto && mergedInto !== current) {
      current = mergedInto;
      followed = true;
      continue;
    }
    if (data.deleted_at) {
      return { vehicle: null, resolved_id: null, followed_merge: followed };
    }
    return { vehicle: data as LiveVehicle, resolved_id: String(data.id), followed_merge: followed };
  }
  return { vehicle: null, resolved_id: null, followed_merge: followed };
}

/** PostgREST query builder scoped to live (non-deleted, non-merged) vehicles. */
export function liveVehicles(sb: AdvisorDb, selectCols: string) {
  return sb
    .from("vehicles")
    .select(selectCols)
    .is("deleted_at", null)
    .is("merged_into_vehicle_id", null);
}

export type SpecFieldResult = {
  field: string;
  value: unknown;
  confidence: number | null;
  confidence_basis: ConfidenceBasis;
  citations: Citation[];
  source: "consensus" | "canonical" | "observation" | "none";
};

const FIELD_TO_CONSENSUS: Record<string, string[]> = {
  exterior_color: ["exterior_color", "color"],
  color: ["color", "exterior_color"],
  body_style: ["body_style"],
  transmission: ["transmission"],
  trim: ["trim"],
  year: ["year"],
  make: ["make"],
  model: ["model"],
  vin: ["vin"],
  mileage: ["mileage"],
  engine_type: ["engine_type"],
  drivetrain: ["drivetrain"],
  interior_color: ["interior_color"],
};

const CANONICAL_FALLBACK: Record<string, string[]> = {
  body_style: ["canonical_body_style", "body_style"],
  transmission: ["transmission", "transmission_type", "transmission_model"],
  exterior_color: ["color"],
};

function confFromNumeric(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Stored as 0..1 or 0..100.
  if (n > 1 && n <= 100) return Math.min(1, n / 100);
  if (n >= 0 && n <= 1) return n;
  return null;
}

async function loadObservationsByIds(
  sb: AdvisorDb,
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const { data } = await sb
      .from("vehicle_observations")
      .select(
        "id, kind, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at",
      )
      .in("id", chunk);
    for (const row of data || []) map.set(String(row.id), row);
  }
  return map;
}

async function loadSourceTrust(
  sb: AdvisorDb,
  sourceIds: string[],
): Promise<Map<string, { display_name: string | null; base_trust_score: number | null }>> {
  const map = new Map();
  const ids = [...new Set(sourceIds.filter(Boolean))];
  if (!ids.length) return map;
  const { data } = await sb
    .from("observation_sources")
    .select("id, display_name, base_trust_score")
    .in("id", ids);
  for (const s of data || []) map.set(s.id, s);
  return map;
}

/**
 * Resolve one or more identity/spec fields from consensus → canonical_* → observations.
 * Confidence always comes from a row (consensus_confidence or observation confidence_score).
 */
export async function resolveSpecFields(
  sb: AdvisorDb,
  vehicleId: string,
  vehicleRow: LiveVehicle,
  fields: readonly string[],
): Promise<Map<string, SpecFieldResult>> {
  const out = new Map<string, SpecFieldResult>();
  const consensusNames = new Set<string>();
  for (const f of fields) {
    for (const n of FIELD_TO_CONSENSUS[f] || [f]) consensusNames.add(n);
  }

  const { data: consensusRows } = await sb
    .from("vehicle_field_consensus")
    .select(
      "field_name, consensus_value, consensus_confidence, supporting_observation_ids, source_observation_id, as_of_at, resolved_at",
    )
    .eq("vehicle_id", vehicleId)
    .in("field_name", [...consensusNames]);

  const byName = new Map<string, Record<string, unknown>>();
  for (const row of consensusRows || []) {
    byName.set(String(row.field_name), row);
  }

  const obsIds: string[] = [];
  for (const row of consensusRows || []) {
    const ids = Array.isArray(row.supporting_observation_ids)
      ? row.supporting_observation_ids.map(String)
      : [];
    if (row.source_observation_id) ids.push(String(row.source_observation_id));
    obsIds.push(...ids);
  }

  // Extra observations for fallback (recent non-superseded).
  const { data: recentObs } = await sb
    .from("vehicle_observations")
    .select(
      "id, kind, structured_data, confidence_score, observed_at, source_url, source_id, is_superseded, ingested_at",
    )
    .eq("vehicle_id", vehicleId)
    .eq("is_superseded", false)
    .order("ingested_at", { ascending: false })
    .limit(80);
  for (const o of recentObs || []) obsIds.push(String(o.id));

  const obsMap = await loadObservationsByIds(sb, obsIds);
  for (const o of recentObs || []) {
    if (!obsMap.has(String(o.id))) obsMap.set(String(o.id), o);
  }
  const sourceMap = await loadSourceTrust(
    sb,
    [...obsMap.values()].map((o) => String(o.source_id || "")),
  );

  for (const field of fields) {
    const aliases = FIELD_TO_CONSENSUS[field] || [field];
    let consensus: Record<string, unknown> | null = null;
    for (const a of aliases) {
      if (byName.has(a)) {
        consensus = byName.get(a)!;
        break;
      }
    }

    if (consensus && consensus.consensus_value != null && consensus.consensus_value !== "") {
      const supportIds: string[] = [];
      if (Array.isArray(consensus.supporting_observation_ids)) {
        supportIds.push(...consensus.supporting_observation_ids.map(String));
      }
      if (consensus.source_observation_id) {
        supportIds.push(String(consensus.source_observation_id));
      }
      const citations: Citation[] = [];
      for (const oid of [...new Set(supportIds)].slice(0, 5)) {
        const o = obsMap.get(oid);
        if (!o) {
          citations.push(
            emptyCitation({
              source_name: "vehicle_field_consensus",
              source_url: null,
              observation_id: oid,
              event_time: consensus.as_of_at ? String(consensus.as_of_at) : null,
              ingested_at: consensus.resolved_at ? String(consensus.resolved_at) : null,
              is_superseded: false,
            }),
          );
          continue;
        }
        const src = sourceMap.get(String(o.source_id || ""));
        citations.push(
          citationFromObservation({
            ...o,
            source_name: src?.display_name ?? "observation",
            source_trust: src?.base_trust_score ?? null,
          }),
        );
      }
      if (!citations.length) {
        citations.push(
          emptyCitation({
            source_name: "vehicle_field_consensus",
            source_url: null,
            observation_id: null,
            event_time: consensus.as_of_at ? String(consensus.as_of_at) : null,
            ingested_at: consensus.resolved_at ? String(consensus.resolved_at) : null,
            is_superseded: false,
          }),
        );
      }
      let conf = confFromNumeric(consensus.consensus_confidence);
      // Prefer observation confidence when supporting obs exist.
      for (const oid of supportIds) {
        const o = obsMap.get(oid);
        const oc = confFromNumeric(o?.confidence_score);
        if (oc != null) {
          conf = oc;
          break;
        }
      }
      out.set(field, {
        field,
        value: coerceFieldValue(field, consensus.consensus_value),
        confidence: conf,
        confidence_basis: conf != null ? "consensus" : "none",
        citations,
        source: "consensus",
      });
      continue;
    }

    // Canonical / vehicle column fallback — confidence only if a *_confidence column exists.
    const colNames = CANONICAL_FALLBACK[field] ||
      (field === "exterior_color" ? ["color"] : [field]);
    let colVal: unknown = null;
    let colNameUsed: string | null = null;
    for (const c of colNames) {
      if (vehicleRow[c] != null && vehicleRow[c] !== "") {
        colVal = vehicleRow[c];
        colNameUsed = c;
        break;
      }
    }
    if (colVal != null) {
      const confCol = vehicleRow[`${colNameUsed}_confidence`] ??
        vehicleRow[`${field}_confidence`] ??
        null;
      const conf = confFromNumeric(confCol);
      out.set(field, {
        field,
        value: coerceFieldValue(field, colVal),
        confidence: conf,
        confidence_basis: conf != null ? "claim_score" : "none",
        citations: [
          emptyCitation({
            source_name: colNameUsed?.startsWith("canonical_")
              ? "vehicles.canonical"
              : "vehicles",
            source_url: (vehicleRow.listing_url || vehicleRow.bat_auction_url || null) as
              | string
              | null,
            observation_id: null,
            event_time: null,
            ingested_at: (vehicleRow.updated_at as string) || null,
            is_superseded: false,
          }),
        ],
        source: "canonical",
      });
      continue;
    }

    // Observation structured_data fallback.
    const keys = aliases.concat(field === "exterior_color" ? ["color"] : []);
    let found: SpecFieldResult | null = null;
    for (const o of obsMap.values()) {
      if (o.is_superseded) continue;
      const sd = (o.structured_data || null) as Record<string, unknown> | null;
      if (!sd) continue;
      let hit: unknown = null;
      for (const k of keys) {
        if (sd[k] != null && sd[k] !== "") {
          hit = sd[k];
          break;
        }
      }
      if (hit == null) continue;
      const src = sourceMap.get(String(o.source_id || ""));
      const conf = confFromNumeric(o.confidence_score) ??
        confFromNumeric(src?.base_trust_score);
      found = {
        field,
        value: coerceFieldValue(field, hit),
        confidence: conf,
        confidence_basis: conf != null
          ? (o.confidence_score != null ? "claim_score" : "source_trust")
          : "none",
        citations: [
          citationFromObservation({
            ...o,
            source_name: src?.display_name ?? "observation",
            source_trust: src?.base_trust_score ?? null,
          }),
        ],
        source: "observation",
      };
      break;
    }
    out.set(
      field,
      found || {
        field,
        value: null,
        confidence: null,
        confidence_basis: "none",
        citations: [],
        source: "none",
      },
    );
  }

  return out;
}

function coerceFieldValue(field: string, raw: unknown): unknown {
  if (raw == null) return null;
  if (field === "year" || field === "mileage") {
    const n = Number(String(raw).replace(/,/g, ""));
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

/** Dedupe vehicle_events by normalized source_url (+ type/status/date). */
export function dedupeEvents(
  events: Record<string, unknown>[],
): { events: Record<string, unknown>[]; duplicates_removed: number } {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  let dupes = 0;
  for (const e of events) {
    const url = canonicalListingUrl(String(e.source_url || ""));
    const when = String(e.sold_at || e.ended_at || e.started_at || "").slice(0, 10);
    const key = [
      url || e.id,
      String(e.event_type || ""),
      String(e.event_status || ""),
      when,
      e.final_price != null ? String(Math.round(Number(e.final_price))) : "",
    ].join("|");
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    out.push(e);
  }
  return { events: out, duplicates_removed: dupes };
}

export { LIVE_VEHICLE_COLS };
