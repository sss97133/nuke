/**
 * api-v1-vision / listing: one condition read of a listing's photos, made only when someone asks for it.
 *
 *   POST /api-v1-vision/listing   { vehicle_id: <uuid>, max_photos?: 1–16 (default 12) }
 *
 * Price follows condition, and a classified listing arrives with photos but no condition read: on 2026-10-15 none of
 * 690 photos on 60 recent Craigslist cars had one. This route is the Analyze button on a listing card. It reads up to
 * max_photos of a public vehicle's photos, folds the per-photo reads into one listing read (aggregateListingRead) and
 * writes that read once through ingest-observation: source nuke-vision, kind condition, agent_inferred, so the writer
 * caps its confidence at 0.6. Nothing here runs when a listing arrives.
 *
 * Who may call: index.ts runs requireWriteAuth, then requireAdminOrService, before this module is reached, so only the
 * service key or an active admin gets here.
 * Who pays: YONO first, with no per-call charge. When a YONO call fails, YONO is not called again in this request, and
 * the photos still unread go to the caller's own connected provider (cloudAnalyze in _shared/visionFallback.ts: BYOK,
 * the caller pays; Nuke never funds cloud inference). No read from either → 503, and nothing is written.
 * How many: LISTING_ANALYSES_PER_DAY (default 40) listing reads written in the last 24 h, counted before any analyzer
 * is called; at the cap the route answers 429.
 */

export const LISTING_SEGMENT = "listing";
export const LISTING_ANALYSIS_KIND = "listing_photo_condition_v1";
export const LISTING_SOURCE_SLUG = "nuke-vision";
export const DEFAULT_MAX_PHOTOS = 12;
export const MAX_PHOTOS = 16;
export const DEFAULT_DAILY_CAP = 40;
/** Analysis stops starting new photos after this, so the answer beats the platform's 150 s request idle timeout. */
export const LISTING_BUDGET_MS = 120_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DB_TIMEOUT_MS = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONDITION_SCALE = "1-5: 5 concours, 1 project";

/** Who bore a photo read's cost: Nuke's own YONO, or the caller's connected provider (BYOK). */
export type CostBearer = "nuke" | "user" | "system";

/** One photo's read, in the same fields whichever analyzer made it. */
export interface PhotoFields {
  vehicle_zone: string | null;
  /** 1–5: 5 concours, 1 project */
  condition_score: number | null;
  damage_flags: string[];
  modification_flags: string[];
  /** 1–5, interior photos only; YONO reads it, the cloud prompt does not */
  interior_quality: number | null;
  /** YONO answers 1–5; the cloud prompt answers high | medium | low */
  photo_quality: number | string | null;
  photo_type: string | null;
  is_vehicle: boolean | null;
  /** the analyzer's own model: YONO's head version, or the provider's model */
  model: string | null;
  ms: number | null;
}

export interface PhotoRead {
  /** "yono", or provider/model for the caller's connected provider */
  analyzer: string;
  cost_bearer: CostBearer;
  fields: PhotoFields;
}

export interface Analyzer {
  /** how a photo's `tried` list names it */
  name: string;
  /** the longest one call may take */
  timeoutMs: number;
  /** calls in flight at once, after the first */
  concurrency: number;
  /** true: one failure stops this analyzer for the rest of the request (YONO) */
  stopOnFailure: boolean;
  /** null when the analyzer gave no read */
  read(imageUrl: string, timeoutMs: number): Promise<PhotoRead | null>;
}

export interface ListingPhoto {
  id: string;
  image_url: string;
}

export interface PhotoOutcome {
  image_id: string;
  image_url: string;
  read: PhotoRead | null;
  /** the analyzers asked about this photo, in order */
  tried: string[];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

/** YONO's /analyze answer (yono/server.py) as a photo read. */
export function yonoPhotoRead(r: {
  vehicle_zone?: unknown; condition_score?: unknown; damage_flags?: unknown; modification_flags?: unknown;
  interior_quality?: unknown; photo_quality?: unknown; photo_type?: unknown; model?: unknown; ms?: unknown;
}): PhotoRead {
  return {
    analyzer: "yono",
    cost_bearer: "nuke",
    fields: {
      vehicle_zone: text(r.vehicle_zone),
      condition_score: num(r.condition_score),
      damage_flags: texts(r.damage_flags),
      modification_flags: texts(r.modification_flags),
      interior_quality: num(r.interior_quality),
      photo_quality: num(r.photo_quality),
      photo_type: text(r.photo_type),
      is_vehicle: null,
      model: text(r.model),
      ms: num(r.ms),
    },
  };
}

/** cloudAnalyze's answer (_shared/visionFallback.ts, the caller's connected provider) as a photo read. */
export function cloudPhotoRead(r: {
  provider: string; model: string; keySource: "user" | "system"; ms?: number;
  vehicle_zone?: string | null; condition_score?: number | null; damage_flags?: string[]; modification_flags?: string[];
  photo_quality?: string | null; is_vehicle?: boolean | null;
}): PhotoRead {
  return {
    analyzer: `${r.provider}/${r.model}`,
    cost_bearer: r.keySource,
    fields: {
      vehicle_zone: text(r.vehicle_zone),
      condition_score: num(r.condition_score),
      damage_flags: texts(r.damage_flags),
      modification_flags: texts(r.modification_flags),
      interior_quality: null,
      photo_quality: text(r.photo_quality),
      photo_type: null,
      is_vehicle: typeof r.is_vehicle === "boolean" ? r.is_vehicle : null,
      model: text(r.model),
      ms: num(r.ms),
    },
  };
}

/** Holds a call to `ms`: a late answer counts as no answer. */
async function within<T>(work: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([work.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads each photo with the first analyzer that answers, in the order given. Each analyzer is first asked about one
 * unread photo alone; no read there and it is not asked about the rest (so a dead YONO costs one call, and a caller
 * with no connected provider costs one lookup). That first photo is one no analyzer has failed on yet, when there is
 * one, so a single dead image URL does not pass for a dead analyzer. An analyzer with stopOnFailure also stops at its
 * first failure later. No call starts after `deadline` (epoch ms).
 */
export async function readPhotos(
  photos: ListingPhoto[],
  analyzers: Analyzer[],
  deadline: number,
  now: () => number = Date.now,
): Promise<PhotoOutcome[]> {
  const outcomes: PhotoOutcome[] = photos.map((p) => ({ image_id: p.id, image_url: p.image_url, read: null, tried: [] }));
  const ask = async (analyzer: Analyzer, o: PhotoOutcome): Promise<boolean> => {
    const ms = Math.max(1, Math.min(analyzer.timeoutMs, deadline - now()));
    o.tried.push(analyzer.name);
    o.read = await within(analyzer.read(o.image_url, ms), ms);
    return o.read !== null;
  };
  for (const analyzer of analyzers) {
    const [first, ...rest] = outcomes.filter((o) => o.read === null).sort((a, b) => a.tried.length - b.tried.length);
    if (!first || now() >= deadline) break;
    if (!(await ask(analyzer, first))) continue;
    let stopped = false;
    let next = 0;
    const worker = async () => {
      while (next < rest.length && !stopped && now() < deadline) {
        if (!(await ask(analyzer, rest[next++])) && analyzer.stopOnFailure) stopped = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(analyzer.concurrency, rest.length) }, worker));
  }
  return outcomes;
}

export interface FlagCount {
  flag: string;
  /** photos that showed it */
  photos: number;
}

export interface ListingRead {
  photos_requested: number;
  photos_analyzed: number;
  /** the analyzer that read every photo, "mixed" when more than one did, null when none did */
  analyzer: string | null;
  analyzers: Record<string, number>;
  cost_bearer: CostBearer | "mixed" | null;
  cost_bearers: Record<string, number>;
  /** 0 when YONO read every photo; null when a connected provider read any, since its charge is not visible here */
  cost_usd: number | null;
  /** median of the per-photo scores on the 1–5 scale */
  condition_score: number | null;
  condition_scale: string;
  condition_scores_counted: number;
  zones_seen: string[];
  damage_flags: FlagCount[];
  modification_flags: FlagCount[];
  /** median of the interior photos' 1–5 reads */
  interior_quality: number | null;
  /** median of the 1–5 reads, and every value as the analyzers gave it */
  photo_quality: { median: number | null; by_value: Record<string, number> };
  photos: Array<Record<string, unknown>>;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** A model can answer 0 or 10; only the 1–5 scale counts. */
const onScale = (v: number | null): v is number => v !== null && v >= 1 && v <= 5;

/** "Paint Fade " and "paint-fade" are the flag paint_fade. */
export function normalizeFlag(flag: string): string {
  return flag.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function flagCounts(perPhoto: string[][]): FlagCount[] {
  const counts = new Map<string, number>();
  for (const flags of perPhoto) {
    for (const flag of new Set(flags.map(normalizeFlag).filter(Boolean))) counts.set(flag, (counts.get(flag) ?? 0) + 1);
  }
  return [...counts].map(([flag, photos]) => ({ flag, photos }))
    .sort((a, b) => b.photos - a.photos || a.flag.localeCompare(b.flag));
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of [...values].sort()) out[v] = (out[v] ?? 0) + 1;
  return out;
}

const single = <T extends string>(counts: Record<string, number>): T | "mixed" | null => {
  const keys = Object.keys(counts);
  return keys.length === 0 ? null : keys.length === 1 ? keys[0] as T : "mixed";
};

/** The per-photo reads folded into one listing read. Pure: the same outcomes give the same read. */
export function aggregateListingRead(outcomes: PhotoOutcome[]): ListingRead {
  const read = outcomes.flatMap((o) => (o.read ? [o.read] : []));
  const fields = read.map((r) => r.fields);
  const scores = fields.map((f) => f.condition_score).filter(onScale);
  const analyzers = tally(read.map((r) => r.analyzer));
  const bearers = tally(read.map((r) => r.cost_bearer));
  const qualityScores = fields.map((f) => (typeof f.photo_quality === "number" ? f.photo_quality : null)).filter(onScale);
  const qualityValues = fields.flatMap((f) => (f.photo_quality === null ? [] : [String(f.photo_quality).toLowerCase()]));
  return {
    photos_requested: outcomes.length,
    photos_analyzed: read.length,
    analyzer: single(analyzers),
    analyzers,
    cost_bearer: single<CostBearer>(bearers),
    cost_bearers: bearers,
    cost_usd: read.length > 0 && read.every((r) => r.cost_bearer === "nuke") ? 0 : null,
    condition_score: median(scores),
    condition_scale: CONDITION_SCALE,
    condition_scores_counted: scores.length,
    zones_seen: [...new Set(fields.flatMap((f) => (f.vehicle_zone ? [f.vehicle_zone] : [])))].sort(),
    damage_flags: flagCounts(fields.map((f) => f.damage_flags)),
    modification_flags: flagCounts(fields.map((f) => f.modification_flags)),
    interior_quality: median(fields.map((f) => f.interior_quality).filter(onScale)),
    photo_quality: { median: median(qualityScores), by_value: tally(qualityValues) },
    photos: outcomes.map((o) => o.read
      ? { image_id: o.image_id, image_url: o.image_url, analyzer: o.read.analyzer, cost_bearer: o.read.cost_bearer, ...o.read.fields }
      : { image_id: o.image_id, image_url: o.image_url, analyzer: null, tried: o.tried }),
  };
}

/** The read in one plain line: the observation's content_text. */
export function listingSummary(read: ListingRead): string {
  const flags = (list: FlagCount[]) => list.map((f) => `${f.flag} (${f.photos} photo${f.photos === 1 ? "" : "s"})`).join(", ");
  const parts = [
    `Condition read of ${read.photos_analyzed} of ${read.photos_requested} listing photos by ${read.analyzer ?? "no analyzer"}`,
    read.condition_score === null
      ? "condition not scored"
      : `median condition ${read.condition_score} of 5 (5 concours, 1 project)`,
    read.damage_flags.length ? `damage seen: ${flags(read.damage_flags)}` : "no damage flagged",
  ];
  if (read.modification_flags.length) parts.push(`modifications seen: ${flags(read.modification_flags)}`);
  if (read.zones_seen.length) parts.push(`zones: ${read.zones_seen.join(", ")}`);
  return `${parts.join("; ")}.`;
}

export type ListingInput = { ok: true; vehicleId: string; maxPhotos: number } | { ok: false; error: string };

export function parseListingBody(body: unknown): ListingInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object: { vehicle_id, max_photos? }" };
  }
  const { vehicle_id, max_photos } = body as Record<string, unknown>;
  if (typeof vehicle_id !== "string" || !UUID_RE.test(vehicle_id)) return { ok: false, error: "vehicle_id must be a uuid" };
  const vehicleId = vehicle_id.toLowerCase();
  if (max_photos === undefined || max_photos === null) return { ok: true, vehicleId, maxPhotos: DEFAULT_MAX_PHOTOS };
  if (typeof max_photos !== "number" || !Number.isInteger(max_photos) || max_photos < 1) {
    return { ok: false, error: `max_photos must be a whole number from 1 to ${MAX_PHOTOS}` };
  }
  return { ok: true, vehicleId, maxPhotos: Math.min(max_photos, MAX_PHOTOS) };
}

/** LISTING_ANALYSES_PER_DAY: a whole number of reads (0 turns the route off); anything else is the default. */
export function dailyCap(raw: string | undefined): number {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CAP;
}

export interface ListingVehicle {
  id: string;
  is_public: boolean | null;
  deleted_at: string | null;
  listing_kind: string | null;
  listing_url: string | null;
  discovery_url: string | null;
}

/** The reads this route makes. Every method throws when the database does not answer. */
export interface ListingStore {
  sourceId(slug: string): Promise<string | null>;
  /** listing reads this route wrote since `since`, counting at most `limit` of them */
  recentReads(sourceId: string, since: string, limit: number): Promise<number>;
  vehicle(id: string): Promise<ListingVehicle | null>;
  photos(vehicleId: string, limit: number): Promise<ListingPhoto[]>;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** The store on the function's service-role client. */
export function listingStore(db: Db): ListingStore {
  const answer = <T>(table: string, r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    return r.data;
  };
  const timeout = () => AbortSignal.timeout(DB_TIMEOUT_MS);
  return {
    async sourceId(slug) {
      const row = answer("observation_sources", await db.from("observation_sources").select("id")
        .eq("slug", slug).abortSignal(timeout()).maybeSingle());
      return (row as { id?: string } | null)?.id ?? null;
    },
    async recentReads(sourceId, since, limit) {
      // Bounded twice: LIMIT `limit`, and a BitmapAnd of idx_observations_source (this source) and
      // idx_observations_kind_time (one day of condition rows) under the JSON filter (EXPLAIN, 2026-10-15).
      const rows = answer("vehicle_observations", await db.from("vehicle_observations").select("id")
        .eq("source_id", sourceId).eq("kind", "condition").gte("ingested_at", since)
        .eq("structured_data->>analysis_kind", LISTING_ANALYSIS_KIND)
        .limit(limit).abortSignal(timeout()));
      return Array.isArray(rows) ? rows.length : 0;
    },
    async vehicle(id) {
      return answer("vehicles", await db.from("vehicles")
        .select("id,is_public,deleted_at,listing_kind,listing_url,discovery_url")
        .eq("id", id).abortSignal(timeout()).maybeSingle()) as ListingVehicle | null;
    },
    async photos(vehicleId, limit) {
      // vehicle_images_vehicle_id_idx, then a sort of that vehicle's rows (EXPLAIN, 2026-10-15). position is 0 on
      // every classified photo, so id is the deterministic order. Documents, duplicates and superseded rows are not
      // photos of the car to read.
      const rows = answer("vehicle_images", await db.from("vehicle_images").select("id,image_url")
        .eq("vehicle_id", vehicleId)
        .not("is_document", "is", true).not("is_duplicate", "is", true).not("is_superseded", "is", true)
        .order("id", { ascending: true }).limit(limit).abortSignal(timeout()));
      return (Array.isArray(rows) ? rows : [])
        .filter((r: Partial<ListingPhoto>) => typeof r.id === "string" && typeof r.image_url === "string" && r.image_url.trim() !== "")
        .map((r: ListingPhoto) => ({ id: r.id, image_url: r.image_url }));
    },
  };
}

export type ListingWrite = { ok: true; observationId: string } | { ok: false; error: string };

export interface ListingContext {
  store: ListingStore;
  /** in the order to try them: YONO, then the caller's connected provider */
  analyzers: Analyzer[];
  /** one call to ingest-observation with the service key */
  write: (observation: Record<string, unknown>) => Promise<ListingWrite>;
  /** the admin who asked; null for the service key */
  userId: string | null;
  env: (name: string) => string | undefined;
  /** CORS headers */
  headers: Record<string, string>;
  /** epoch ms */
  now?: () => number;
  budgetMs?: number;
}

const httpUrl = (u: string | null): string | null => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** The ingest-observation body for one listing read. */
export function listingObservation(
  vehicle: ListingVehicle,
  read: ListingRead & { time_budget_reached: boolean },
  observedAt: string,
  requestedBy: string | null,
  durationMs: number,
): Record<string, unknown> {
  const sourceUrl = httpUrl(vehicle.listing_url) ?? httpUrl(vehicle.discovery_url);
  return {
    source_slug: LISTING_SOURCE_SLUG,
    kind: "condition",
    observed_at: observedAt,
    vehicle_id: vehicle.id,
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    content_text: listingSummary(read),
    structured_data: { analysis_kind: LISTING_ANALYSIS_KIND, ...read },
    // A model read the photos and no person confirmed it: the writer caps the confidence at 0.6.
    agent_inferred: true,
    extraction_method: LISTING_ANALYSIS_KIND,
    agent_model: read.analyzer === "mixed" ? null : read.analyzer,
    agent_duration_ms: durationMs,
    observer_raw: { extracted_by: "api-v1-vision/listing", requested_by_user_id: requestedBy },
  };
}

export async function handleListing(req: Request, ctx: ListingContext): Promise<Response> {
  const now = ctx.now ?? Date.now;
  const started = now();
  const send = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...ctx.headers, "Content-Type": "application/json" } });
  if (req.method !== "POST") return send({ error: "POST /api-v1-vision/listing with { vehicle_id, max_photos? }" }, 405);

  const parsed = parseListingBody(await req.json().catch(() => null));
  if (!parsed.ok) return send({ error: parsed.error }, 400);
  const { vehicleId, maxPhotos } = parsed;

  // The cap is counted before any analyzer runs, and a cap that cannot be counted refuses (it guards the caller's money).
  const cap = dailyCap(ctx.env("LISTING_ANALYSES_PER_DAY"));
  let sourceId: string | null;
  let used = 0;
  try {
    sourceId = await ctx.store.sourceId(LISTING_SOURCE_SLUG);
    if (sourceId && cap > 0) used = await ctx.store.recentReads(sourceId, new Date(started - DAY_MS).toISOString(), cap);
  } catch (e) {
    console.error("[api-v1-vision/listing] cap count failed:", e instanceof Error ? e.message : String(e));
    return send({ error: "the daily cap could not be counted; nothing was analyzed" }, 503);
  }
  if (!sourceId) return send({ error: `observation source ${LISTING_SOURCE_SLUG} is not registered` }, 503);
  if (used >= cap) {
    return send({ error: "daily listing analysis cap reached", cap, used, window_hours: 24, env: "LISTING_ANALYSES_PER_DAY" }, 429);
  }

  let vehicle: ListingVehicle | null;
  let photos: ListingPhoto[];
  try {
    vehicle = await ctx.store.vehicle(vehicleId);
    if (!vehicle || vehicle.is_public !== true || vehicle.deleted_at !== null || vehicle.listing_kind === "non_vehicle_item") {
      return send({ error: "no public vehicle with this id", vehicle_id: vehicleId }, 404);
    }
    photos = await ctx.store.photos(vehicleId, maxPhotos);
  } catch (e) {
    console.error("[api-v1-vision/listing] vehicle read failed:", e instanceof Error ? e.message : String(e));
    return send({ error: "the vehicle or its photos could not be read" }, 503);
  }
  if (photos.length === 0) return send({ error: "this vehicle has no photos to read", vehicle_id: vehicleId }, 422);

  const deadline = started + (ctx.budgetMs ?? LISTING_BUDGET_MS);
  const outcomes = await readPhotos(photos, ctx.analyzers, deadline, now);
  const read = {
    ...aggregateListingRead(outcomes),
    time_budget_reached: now() >= deadline && outcomes.some((o) => o.read === null),
  };
  if (read.photos_analyzed === 0) {
    const tried = outcomes.flatMap((o) => o.tried).join(",") || "none";
    console.warn(`[api-v1-vision/listing] no read of ${photos.length} photos of ${vehicleId}; calls: ${tried}`);
    return send({ error: "no analyzer available", hint: "connect your AI subscription" }, 503);
  }

  const durationMs = now() - started;
  const written = await ctx.write(listingObservation(vehicle, read, new Date(now()).toISOString(), ctx.userId, durationMs));
  if (!written.ok) {
    console.error("[api-v1-vision/listing] ingest-observation refused the read:", written.error);
    return send({ error: "the listing read was made but not written", write_error: written.error, vehicle_id: vehicleId, ...read }, 502);
  }
  return send({ observation_id: written.observationId, vehicle_id: vehicleId, ...read, elapsed_ms: now() - started });
}
