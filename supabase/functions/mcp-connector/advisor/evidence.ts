// Evidence envelope for the Nuke Asset Advisor MCP surface.
// Every claim carries a value (or "not recorded"), per-claim confidence, and citations
// that keep event_time separate from ingested_at / scrape clocks.

export const NOT_RECORDED = "not recorded" as const;

export type ConfidenceBasis =
  | "claim_score"
  | "consensus"
  | "source_trust"
  | "estimate_model"
  | "none";

export interface Citation {
  source_name: string | null;
  source_url: string | null;
  observation_id: string | null;
  /** Real-world event time (sale, auction end). Never scrape/ingest time. */
  event_time: string | null;
  /** When Nuke learned / ingested the observation. */
  ingested_at: string | null;
  is_superseded: boolean;
}

export interface Claim {
  field: string;
  value: unknown;
  /** 0..1 when known; null when the field is not recorded or ungraded. */
  confidence: number | null;
  confidence_basis: ConfidenceBasis;
  citations: Citation[];
  /** Sources consulted when value is "not recorded". */
  checked_sources?: string[];
  note?: string;
}

export interface AdvisorEnvelope {
  asset_type: string;
  asset_id: string | null;
  tool: string;
  as_of: string;
  agent_instructions: string;
  claims: Claim[];
  [key: string]: unknown;
}

export const AGENT_CITATION_RULES =
  "Cite every non-missing claim with its source_name, source_url, and event_time when present. " +
  "Never treat ingested_at or scrape clocks as the event date. " +
  "If value is 'not recorded', say so and list checked_sources — do not invent a value.";

/** JSON Schema fragment for structuredContent / outputSchema. */
export const CLAIM_OUTPUT_SCHEMA = {
  type: "object",
  required: ["field", "value", "confidence", "confidence_basis", "citations"],
  properties: {
    field: { type: "string" },
    value: {},
    confidence: { type: ["number", "null"] },
    confidence_basis: {
      type: "string",
      enum: ["claim_score", "consensus", "source_trust", "estimate_model", "none"],
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        required: [
          "source_name",
          "source_url",
          "observation_id",
          "event_time",
          "ingested_at",
          "is_superseded",
        ],
        properties: {
          source_name: { type: ["string", "null"] },
          source_url: { type: ["string", "null"] },
          observation_id: { type: ["string", "null"] },
          event_time: { type: ["string", "null"] },
          ingested_at: { type: ["string", "null"] },
          is_superseded: { type: "boolean" },
        },
      },
    },
    checked_sources: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
} as const;

export const ENVELOPE_OUTPUT_SCHEMA = {
  type: "object",
  required: ["asset_type", "asset_id", "tool", "as_of", "agent_instructions", "claims"],
  properties: {
    asset_type: { type: "string" },
    asset_id: { type: ["string", "null"] },
    tool: { type: "string" },
    as_of: { type: "string" },
    agent_instructions: { type: "string" },
    claims: { type: "array", items: CLAIM_OUTPUT_SCHEMA },
  },
  additionalProperties: true,
} as const;

export function emptyCitation(partial: Partial<Citation> = {}): Citation {
  return {
    source_name: partial.source_name ?? null,
    source_url: partial.source_url ?? null,
    observation_id: partial.observation_id ?? null,
    event_time: partial.event_time ?? null,
    ingested_at: partial.ingested_at ?? null,
    is_superseded: partial.is_superseded ?? false,
  };
}

/**
 * Prefer real event clocks inside structured_data / event rows over observed_at.
 * observed_at is often scrape time and must not be promoted to event_time.
 */
export function extractEventTime(
  structured: Record<string, unknown> | null | undefined,
  fallbacks: Array<string | null | undefined> = [],
): string | null {
  const sd = structured && typeof structured === "object" ? structured : null;
  const keys = [
    "sold_at",
    "sale_date",
    "sale_on",
    "source_event_at",
    "ended_at",
    "event_time",
    "occurred_at",
    "auction_end",
  ];
  if (sd) {
    for (const k of keys) {
      const v = sd[k];
      if (typeof v === "string" && v.trim()) return normalizeTime(v);
      // nested receipt shapes
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const nested = v as Record<string, unknown>;
        for (const nk of ["on", "at", "date", "sold_at"]) {
          if (typeof nested[nk] === "string" && (nested[nk] as string).trim()) {
            return normalizeTime(nested[nk] as string);
          }
        }
      }
    }
    const receipt = sd.source_sale_receipt;
    if (receipt && typeof receipt === "object") {
      const r = receipt as Record<string, unknown>;
      for (const nk of ["on", "at", "date", "sold_at", "sale_date"]) {
        if (typeof r[nk] === "string" && (r[nk] as string).trim()) {
          return normalizeTime(r[nk] as string);
        }
      }
    }
  }
  for (const f of fallbacks) {
    if (typeof f === "string" && f.trim()) return normalizeTime(f);
  }
  return null;
}

function normalizeTime(v: string): string {
  // Keep date-only strings as YYYY-MM-DD; ISO timestamps as-is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = Date.parse(v);
  if (!Number.isNaN(d)) return new Date(d).toISOString();
  return v;
}

export function resolveClaimConfidence(
  claimScore: number | null | undefined,
  sourceTrust: number | null | undefined,
): { confidence: number | null; confidence_basis: ConfidenceBasis } {
  if (claimScore != null && Number.isFinite(Number(claimScore))) {
    const c = Number(claimScore);
    // Heuristic: scores stored as 0-100 (nuke_estimate_confidence) vs 0-1.
    const norm = c > 1 ? Math.min(c / 100, 1) : Math.max(0, Math.min(c, 1));
    if (sourceTrust != null && Number.isFinite(Number(sourceTrust))) {
      const st = Number(sourceTrust) > 1 ? Number(sourceTrust) / 100 : Number(sourceTrust);
      if (Math.abs(norm - st) < 0.001) {
        return { confidence: norm, confidence_basis: "source_trust" };
      }
    }
    return { confidence: norm, confidence_basis: "claim_score" };
  }
  if (sourceTrust != null && Number.isFinite(Number(sourceTrust))) {
    const st = Number(sourceTrust);
    return {
      confidence: st > 1 ? Math.min(st / 100, 1) : Math.max(0, Math.min(st, 1)),
      confidence_basis: "source_trust",
    };
  }
  return { confidence: null, confidence_basis: "none" };
}

export function recordedClaim(
  field: string,
  value: unknown,
  opts: {
    confidence?: number | null;
    confidence_basis?: ConfidenceBasis;
    citations?: Citation[];
    note?: string;
  } = {},
): Claim {
  if (value === null || value === undefined || value === "") {
    return notRecordedClaim(field, {
      checked_sources: (opts.citations || [])
        .map((c) => c.source_name || c.source_url)
        .filter((x): x is string => Boolean(x)),
      citations: opts.citations,
      note: opts.note,
    });
  }
  return {
    field,
    value,
    confidence: opts.confidence ?? null,
    confidence_basis: opts.confidence_basis ?? (opts.confidence == null ? "none" : "claim_score"),
    citations: opts.citations ?? [],
    ...(opts.note ? { note: opts.note } : {}),
  };
}

export function notRecordedClaim(
  field: string,
  opts: {
    checked_sources?: string[];
    citations?: Citation[];
    note?: string;
  } = {},
): Claim {
  return {
    field,
    value: NOT_RECORDED,
    confidence: null,
    confidence_basis: "none",
    citations: opts.citations ?? [],
    checked_sources: opts.checked_sources ?? [],
    ...(opts.note ? { note: opts.note } : {}),
  };
}

export function makeEnvelope(
  tool: string,
  assetType: string,
  assetId: string | null,
  claims: Claim[],
  extra: Record<string, unknown> = {},
): AdvisorEnvelope {
  return {
    asset_type: assetType,
    asset_id: assetId,
    tool,
    as_of: new Date().toISOString(),
    agent_instructions: AGENT_CITATION_RULES,
    claims,
    ...extra,
  };
}

export function citationFromObservation(o: {
  id?: string | null;
  source_name?: string | null;
  source_url?: string | null;
  ingested_at?: string | null;
  is_superseded?: boolean | null;
  structured_data?: Record<string, unknown> | null;
  observed_at?: string | null;
  source_trust?: number | null;
  confidence_score?: number | null;
  source_event_at?: string | null;
}): Citation {
  return emptyCitation({
    source_name: o.source_name ?? null,
    source_url: o.source_url ?? null,
    observation_id: o.id ?? null,
    event_time: extractEventTime(o.structured_data ?? null, [o.source_event_at]),
    ingested_at: o.ingested_at ?? null,
    is_superseded: Boolean(o.is_superseded),
  });
}

/** Best sale-date recovery observation per vehicle_events.id (by confidence_score). */
export interface RecoveredSaleClock {
  event_id: string;
  source_event_at: string;
  precision: string | null;
  basis: string | null;
  confidence: number | null;
  observation_id: string | null;
  citation_excerpt: string | null;
  rule: string | null;
}

export async function loadBestRecoveredSaleClocks(
  // deno-lint-ignore no-explicit-any
  sb: any,
  eventIds: string[],
): Promise<Map<string, RecoveredSaleClock>> {
  const map = new Map<string, RecoveredSaleClock>();
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (!ids.length) return map;
  const { data, error } = await sb.rpc("sale_date_recovery_best_for_events", {
    p_event_ids: ids,
  });
  if (error || !Array.isArray(data)) return map;
  for (const row of data) {
    const eventId = row.event_id as string;
    if (!eventId || map.has(eventId)) continue;
    const at = row.source_event_at;
    if (typeof at !== "string" || !at.trim()) continue;
    map.set(eventId, {
      event_id: eventId,
      source_event_at: at,
      precision: (row.precision as string) ?? null,
      basis: (row.basis as string) ?? null,
      confidence: row.confidence != null ? Number(row.confidence) : null,
      observation_id: (row.observation_id as string) ?? null,
      citation_excerpt: (row.citation_excerpt as string) ?? null,
      rule: (row.rule as string) ?? null,
    });
  }
  return map;
}

/**
 * Prefer native sold_at/ended_at when present; otherwise the highest-confidence
 * sale_date_recovery observation. Placeholder-flagged native clocks yield to a
 * higher-confidence recovery observation when both exist.
 */
export function resolveEventSaleClock(
  event: {
    id?: string | null;
    sold_at?: string | null;
    ended_at?: string | null;
    started_at?: string | null;
    sold_at_precision?: string | null;
  },
  recovered: RecoveredSaleClock | null | undefined,
): {
  event_time: string | null;
  clock_source: "sold_at" | "ended_at" | "started_at" | "recovery" | "none";
  precision: string | null;
  recovery: RecoveredSaleClock | null;
} {
  const nativeSold = typeof event.sold_at === "string" && event.sold_at.trim() ? event.sold_at : null;
  const nativeEnded = typeof event.ended_at === "string" && event.ended_at.trim() ? event.ended_at : null;
  const nativeStarted =
    typeof event.started_at === "string" && event.started_at.trim() ? event.started_at : null;
  const placeholder =
    event.sold_at_precision === "month_placeholder" ||
    event.sold_at_precision === "auction_level";
  const rec = recovered && recovered.source_event_at ? recovered : null;
  const recConf = rec?.confidence != null && Number.isFinite(rec.confidence) ? Number(rec.confidence) : 0;

  if (nativeSold && !(placeholder && rec && recConf >= 0.7)) {
    return {
      event_time: normalizeTime(nativeSold),
      clock_source: "sold_at",
      precision: event.sold_at_precision ?? "day",
      recovery: rec,
    };
  }
  if (nativeEnded && !(placeholder && rec && recConf >= 0.7)) {
    return {
      event_time: normalizeTime(nativeEnded),
      clock_source: "ended_at",
      precision: event.sold_at_precision ?? null,
      recovery: rec,
    };
  }
  if (rec) {
    return {
      event_time: normalizeTime(rec.source_event_at),
      clock_source: "recovery",
      precision: rec.precision,
      recovery: rec,
    };
  }
  if (nativeStarted) {
    return {
      event_time: normalizeTime(nativeStarted),
      clock_source: "started_at",
      precision: null,
      recovery: null,
    };
  }
  return { event_time: null, clock_source: "none", precision: null, recovery: null };
}

export function assertEnvelopeShape(data: unknown): asserts data is AdvisorEnvelope {
  if (!data || typeof data !== "object") throw new Error("envelope must be an object");
  const e = data as Record<string, unknown>;
  for (const k of ["asset_type", "tool", "as_of", "agent_instructions", "claims"]) {
    if (!(k in e)) throw new Error(`envelope missing ${k}`);
  }
  if (!Array.isArray(e.claims)) throw new Error("claims must be an array");
  for (const c of e.claims as Claim[]) {
    if (!c || typeof c !== "object") throw new Error("invalid claim");
    if (typeof c.field !== "string") throw new Error("claim.field required");
    if (!("value" in c)) throw new Error("claim.value required");
    if (!("confidence" in c)) throw new Error("claim.confidence required");
    if (!Array.isArray(c.citations)) throw new Error("claim.citations required");
    for (const cit of c.citations) {
      for (const ck of [
        "source_name",
        "source_url",
        "observation_id",
        "event_time",
        "ingested_at",
        "is_superseded",
      ]) {
        if (!(ck in cit)) throw new Error(`citation missing ${ck}`);
      }
    }
    if (c.value === NOT_RECORDED && c.confidence !== null) {
      throw new Error("not-recorded claims must have null confidence");
    }
  }
}
