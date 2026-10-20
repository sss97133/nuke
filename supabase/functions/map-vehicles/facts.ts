// facts.ts: the one map's reads over map_facts (plan step 6). Pure builders, so cells.test.ts-style tests can check
// the SQL and the shaping without a database; index.ts runs them inside readWithin on a direct connection.
//
//   mode=layers                       → the map_layers rows: what each count means
//   mode=areas&level&layer[&source&from&to&keys]
//                                     → one row per area at that level for the window: entities, priced, value, avg;
//                                       plus the unkeyed entities ("no county" / "no ZIP") and the undated ones
//   mode=area&key&level&[from&to]     → one area, every layer: its activity
//
// Rules the reader keeps: a count means exactly one map_layers row; the public test happened in the fold; asking
// and sale values are never summed together (they are different layers); organization is a snapshot (the window does
// not apply); photo rows are never points.

export type Level = "state" | "county" | "zcta";
export const LEVELS: readonly Level[] = ["state", "county", "zcta"];
const LAYER_RE = /^[a-z_]{2,32}$/;
const SOURCE_RE = /^[a-z0-9_-]{2,40}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AreasQuery { level: Level; layer: string; sources: string[]; from: string; to: string; keys: string[] | null }
export interface AreaQuery { level: Level; key: string; from: string; to: string }

export function utcDay(d = new Date()): string { return d.toISOString().slice(0, 10); }
function daysAgo(n: number, now = new Date()): string { return utcDay(new Date(now.getTime() - n * 86_400_000)); }

const list = (v: unknown, re: RegExp) => String(v ?? "").split(",").map((x) => x.trim()).filter((x) => re.test(x));
const keyRe = (level: Level) => (level === "state" ? /^\d{2}$/ : /^\d{5}$/);

/** Parses and bounds the areas request; throws a message fit for a 400. */
export function parseAreas(p: Record<string, unknown>, now = new Date()): AreasQuery {
  const level = String(p.level ?? "county") as Level;
  if (!LEVELS.includes(level)) throw new Error("level must be state, county or zcta");
  const layer = String(p.layer ?? "listing");
  if (!LAYER_RE.test(layer)) throw new Error("layer must be a map_layers key");
  const from = String(p.from ?? daysAgo(30, now)), to = String(p.to ?? utcDay(now));
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new Error("from and to must be YYYY-MM-DD with from <= to");
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 366) throw new Error("window is at most 366 days");
  const keys = p.keys == null ? null : list(p.keys, keyRe(level));
  if (keys && keys.length > 2000) throw new Error("at most 2000 keys");
  if (level === "zcta" && !keys) throw new Error("zcta level needs keys (the ZCTAs in view)");
  return { level, layer, sources: list(p.source, SOURCE_RE), from, to, keys };
}

export function parseArea(p: Record<string, unknown>, now = new Date()): AreaQuery {
  const level = String(p.level ?? "county") as Level;
  if (!LEVELS.includes(level)) throw new Error("level must be state, county or zcta");
  const key = String(p.key ?? "");
  if (!keyRe(level).test(key)) throw new Error(`key must be a ${level} code`);
  const from = String(p.from ?? daysAgo(30, now)), to = String(p.to ?? utcDay(now));
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) throw new Error("from and to must be YYYY-MM-DD with from <= to");
  return { level, key, from, to };
}

/**
 * Areas SQL: one row per area_key (NULL = unkeyed) and one for undated rows (day NULL), for the layer, level, window
 * and sources. organization ignores the window and reads its latest snapshot day.
 */
export function areasSql(q: AreasQuery): { text: string; args: unknown[] } {
  const args: unknown[] = [q.layer, q.level, q.from, q.to, q.sources.length ? q.sources : null, q.keys];
  const text = `
    WITH snap AS (SELECT max(day) AS day FROM map_facts WHERE layer = $1 AND level = $2)
    SELECT f.area_key AS key, (f.day IS NULL) AS undated,
           sum(f.entities)::int AS entities, sum(f.priced)::int AS priced, sum(f.value_sum) AS value, max(f.as_of)::text AS as_of
    FROM map_facts f, snap
    WHERE f.layer = $1 AND f.level = $2
      AND ($5::text[] IS NULL OR f.source_platform = ANY($5))
      AND ($6::text[] IS NULL OR f.area_key = ANY($6))
      AND CASE WHEN $1 = 'organization' THEN f.day = snap.day
               ELSE f.day IS NULL OR (f.day >= $3::date AND f.day <= $4::date) END
    GROUP BY 1, 2`;
  return { text, args };
}

export function bySourceSql(q: AreasQuery): { text: string; args: unknown[] } {
  const args: unknown[] = [q.layer, q.level, q.from, q.to, q.keys];
  const text = `
    WITH snap AS (SELECT max(day) AS day FROM map_facts WHERE layer = $1 AND level = $2)
    SELECT f.source_platform AS source, sum(f.entities)::int AS entities
    FROM map_facts f, snap
    WHERE f.layer = $1 AND f.level = $2 AND ($5::text[] IS NULL OR f.area_key = ANY($5))
      AND CASE WHEN $1 = 'organization' THEN f.day = snap.day ELSE f.day IS NULL OR (f.day >= $3::date AND f.day <= $4::date) END
    GROUP BY 1 ORDER BY 2 DESC`;
  return { text, args };
}

/** One area, every layer: entities, priced, value per layer over the window (organization: latest snapshot). */
export function areaSql(q: AreaQuery): { text: string; args: unknown[] } {
  const args: unknown[] = [q.level, q.key, q.from, q.to];
  const text = `
    SELECT l.layer, l.entity, l.value_basis, l.points_allowed,
           coalesce(sum(f.entities), 0)::int AS entities, coalesce(sum(f.priced), 0)::int AS priced, sum(f.value_sum) AS value,
           max(f.as_of)::text AS as_of, max(f.day)::text AS latest_day
    FROM map_layers l
    LEFT JOIN map_facts f ON f.layer = l.layer AND f.level = $1 AND f.area_key = $2
      AND CASE WHEN l.layer = 'organization'
               THEN f.day = (SELECT max(day) FROM map_facts WHERE layer = 'organization' AND level = $1)
               ELSE f.day >= $3::date AND f.day <= $4::date END
    GROUP BY l.layer, l.entity, l.value_basis, l.points_allowed, l.sort_order
    ORDER BY l.sort_order`;
  return { text, args };
}

export interface AreaRow { key: string | null; undated: boolean; entities: number; priced: number; value: string | null; as_of: string | null }

/** Shapes the areas rows: keyed areas with avg, the unkeyed bucket, the undated bucket, and the newest as_of. */
export function shapeAreas(q: AreasQuery, rows: AreaRow[], bySource: { source: string; entities: number }[]) {
  const areas: { key: string; entities: number; priced: number; value: number; avg: number | null }[] = [];
  let unkeyed = 0, undated = 0, asOf: string | null = null, total = 0, totalValue = 0;
  for (const r of rows) {
    if (r.as_of && (!asOf || r.as_of > asOf)) asOf = r.as_of;
    if (r.undated) { undated += r.entities; continue; }
    total += r.entities;
    const value = r.value == null ? 0 : Number(r.value);
    totalValue += value;
    if (r.key == null) { unkeyed += r.entities; continue; }
    areas.push({ key: r.key, entities: r.entities, priced: r.priced, value, avg: r.priced ? Math.round(value / r.priced) : null });
  }
  areas.sort((a, b) => b.entities - a.entities);
  return {
    level: q.level, layer: q.layer, from: q.from, to: q.to, source: q.sources, keys: q.keys?.length ?? null,
    areas, unkeyed: { entities: unkeyed }, undated: { entities: undated },
    totals: { entities: total, value: totalValue, areas: areas.length }, by_source: bySource, as_of: asOf,
    generated_at: new Date().toISOString(),
  };
}
