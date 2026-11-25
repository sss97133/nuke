// reported_labor_hours_v1: reported labor statements (a seller's, builder's or commenter's own words about hours spent)
// land through the database writer record_reported_labor_statement, which runs reported_labor_statement_check and is
// the only path the admission trigger on vehicle_observations accepts. This mode holds no copy of the rules: it
// validates the request's shape, calls the writer once per statement and reports each disposition (admitted, held,
// refused) with its reasons. Statements land with vehicle_id NULL; their keyed edges are reported_labor_statements.
export const REPORTED_LABOR_MODE = "reported_labor_hours_v1";
export const REPORTED_LABOR_METHOD = "reported_labor_hours_v1";
const MAX_STATEMENTS = 25;
const SOURCE_TABLES = new Set(["auction_comments", "build_posts", "vehicles"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ReportedLaborRefusal extends Error {
  // partial: what landed before a mid-batch failure (each statement commits on its own call), so the caller sees it.
  constructor(message: string, readonly status = 400, readonly partial: Record<string, unknown> = { writes: 0 }) { super(message); }
}

type Statement = {
  source_table: string;
  source_row_id: string;
  quote: string;
  low: number;
  high: number | null;
  qualifiers: Record<string, unknown>;
};

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

function statementOf(raw: unknown, i: number): Statement {
  const s = (raw ?? {}) as Record<string, unknown>;
  const bad = (what: string) => new ReportedLaborRefusal(`statements[${i}]: ${what}`);
  if (typeof s.source_table !== "string" || !SOURCE_TABLES.has(s.source_table)) throw bad("source_table must be auction_comments, build_posts or vehicles");
  if (typeof s.source_row_id !== "string" || !UUID.test(s.source_row_id)) throw bad("source_row_id must be a uuid");
  if (typeof s.quote !== "string" || s.quote.length === 0) throw bad("quote is required, verbatim from the source row");
  if (typeof s.low !== "number" || !Number.isFinite(s.low)) throw bad("low must be the printed figure");
  if (s.high !== undefined && s.high !== null && (typeof s.high !== "number" || !Number.isFinite(s.high))) throw bad("high must be a number or absent");
  if (typeof s.qualifiers !== "object" || s.qualifiers === null || Array.isArray(s.qualifiers)) throw bad("qualifiers must be an object");
  return { source_table: s.source_table, source_row_id: s.source_row_id, quote: s.quote, low: s.low,
           high: (s.high as number | undefined) ?? null, qualifiers: s.qualifiers as Record<string, unknown> };
}

// a replay returns the landed row and writes nothing
const landed = (c: Record<string, number>) => (c.admitted ?? 0) + (c.held ?? 0) - (c.duplicate ?? 0);

export async function ingestReportedLabor(rpc: Rpc, input: Record<string, unknown>) {
  const raw = input.statements;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STATEMENTS) {
    throw new ReportedLaborRefusal(`statements must be an array of 1 to ${MAX_STATEMENTS}`);
  }
  const statements = raw.map(statementOf);
  const reader = (typeof input.reader === "object" && input.reader !== null && !Array.isArray(input.reader))
    ? input.reader as Record<string, unknown> : {};
  const results: Record<string, unknown>[] = [];
  const counts: Record<string, number> = { admitted: 0, held: 0, refused: 0, duplicate: 0 };
  const reasons: Record<string, number> = {};
  for (const s of statements) {
    const { data, error } = await rpc("record_reported_labor_statement", {
      p_source_table: s.source_table, p_source_row_id: s.source_row_id, p_quote: s.quote, p_low: s.low, p_high: s.high,
      p_qualifiers: s.qualifiers, p_reader: reader,
    });
    if (error) {
      throw new ReportedLaborRefusal(`record_reported_labor_statement: ${error.message}`, 500,
        { writes: landed(counts), failed_index: results.length, counts, reasons, results });
    }
    const r = (data ?? {}) as Record<string, unknown>;
    const disposition = String(r.disposition ?? "refused");
    counts[disposition] = (counts[disposition] ?? 0) + 1;
    if (r.duplicate === true) counts.duplicate += 1;
    for (const k of [...((r.reasons as string[] | undefined) ?? []), ...((r.held_reasons as string[] | undefined) ?? [])]) {
      reasons[k] = (reasons[k] ?? 0) + 1;
    }
    results.push({ source_table: s.source_table, source_row_id: s.source_row_id, ...r });
  }
  return { success: true, mode: REPORTED_LABOR_MODE, writes: landed(counts), counts, reasons, results, model_calls: 0 };
}
