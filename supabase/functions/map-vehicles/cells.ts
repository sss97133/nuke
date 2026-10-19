/**
 * The map's two folds of public observations, and the reads that use them.
 *
 * mv_map_public_cells (migration 20261014120000) counts the location observations of public, undeleted vehicles per
 * 0.01-degree cell, with the 0.1- and 1-degree cells each belongs to, UTC month, confidence >= 0.7 band, source and
 * event type. A cluster or histogram request with no time, source, event type or vehicle filter, at confidence 0.5
 * or 0.7, is answered from it: the national view no longer joins 121k observations to vehicles (36-46 s). Anything
 * else reads the live tables with the public test.
 */
import type { PoolClient } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

/** The confidence bands the fold carries: everything it holds (>= 0.5) and the >= 0.7 band. */
export const CELL_CONFIDENCES = [0.5, 0.7] as const;

const FILTER_PARAMS = [
  "time_start", "time_end", "source", "event_type", "make", "year_min", "year_max", "price_min", "price_max",
] as const;

/** True when the fold answers this request exactly: only a bbox, a zoom and a confidence band it carries. */
export function cellsCanAnswer(params: Record<string, unknown>, minConfidence: number): boolean {
  if (!CELL_CONFIDENCES.includes(minConfidence as (typeof CELL_CONFIDENCES)[number])) return false;
  return FILTER_PARAMS.every((k) => params[k] === undefined || params[k] === null || params[k] === "");
}

/** Clusters at precision 0, 1 or 2 from the fold, in the live query's output shape. Args: south, north, west, east, limit. */
export function cellsClusterSql(precision: 0 | 1 | 2, minConfidence: number): string {
  const band = minConfidence >= 0.7 ? "AND conf70" : "";
  return `
    SELECT lng${precision} AS lng, lat${precision} AS lat,
           SUM(n)::int AS count,
           array_agg(DISTINCT source_platform ORDER BY source_platform) FILTER (WHERE source_platform <> '') AS sources,
           array_agg(DISTINCT source_type ORDER BY source_type) AS event_types,
           (SUM(confidence_sum) / SUM(n))::float4 AS avg_confidence
    FROM mv_map_public_cells
    WHERE lat2 BETWEEN $1 AND $2 AND lng2 BETWEEN $3 AND $4 ${band}
    GROUP BY 1, 2
    ORDER BY count DESC
    LIMIT $5`;
}

/** The month histogram from the fold, in the live query's output shape. Args: south, north, west, east. */
export function cellsHistogramSql(minConfidence: number): string {
  const band = minConfidence >= 0.7 ? "AND conf70" : "";
  return `
    SELECT month, SUM(n)::int AS count
    FROM mv_map_public_cells
    WHERE lat2 BETWEEN $1 AND $2 AND lng2 BETWEEN $3 AND $4 ${band}
    GROUP BY 1
    ORDER BY 1`;
}

/** When the fold was last refreshed, or null while it has never been filled (then the live path answers). */
export async function cellsAsOf(conn: PoolClient): Promise<string | null> {
  const { rows } = await conn.queryObject<{ populated: boolean; refreshed_at: string | null }>(`
    SELECT c.relispopulated AS populated,
           CASE WHEN k.relispopulated THEN (SELECT refreshed_at::text FROM mv_map_public_cells_clock LIMIT 1) END AS refreshed_at
    FROM pg_class c, pg_class k
    WHERE c.oid = to_regclass('public.mv_map_public_cells') AND k.oid = to_regclass('public.mv_map_public_cells_clock')`);
  const r = rows[0];
  return r?.populated && r.refreshed_at ? r.refreshed_at : null;
}

/**
 * One read in its own read-only transaction, so its statement_timeout applies: a SET LOCAL outside a transaction lasts
 * only for its own statement, and the pooler's default (about 10 s) had been ending the reads instead.
 */
export async function readWithin<T>(conn: PoolClient, text: string, args: unknown[], timeout = "15s") {
  const tx = conn.createTransaction(`map_read_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`, { read_only: true });
  await tx.begin();
  try {
    await tx.queryObject(`SET LOCAL statement_timeout = '${timeout}'`);
    const result = await tx.queryObject<T>({ text, args });
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch { /* the connection may be gone */ }
    throw e;
  }
}
