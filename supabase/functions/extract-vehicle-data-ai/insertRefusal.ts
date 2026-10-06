/**
 * What the extractor returns when the database refuses the vehicle row.
 *
 * The insert used to log the error and fall through to `success: true` with `vehicle_id: null`. The
 * queue processors read that as a finished item, so process-import-queue and continuous-queue-processor
 * marked the row complete with no vehicle. guard_vehicle_sale_price (migration 20260927170000) refuses a
 * positive sale_price with no sold status as SQLSTATE 23514, and any other insert error took the same road.
 * The caller now gets `success: false`, the database's own message, code and hint, and the extraction
 * it already paid for. `details` is withheld: Postgres puts the offending row values there.
 */
export interface InsertError {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}

export function insertRefusal(
  err: InsertError,
  extracted: unknown,
  url: string,
): { status: number; body: Record<string, unknown> } {
  return {
    // SQLSTATE class 23 refuses this row (integrity or check violation): 422. Anything else is a database fault: 500.
    status: typeof err.code === "string" && err.code.startsWith("23") ? 422 : 500,
    body: {
      success: false,
      error: `Vehicle insert refused: ${err.message || "the database gave no message"}`,
      error_code: err.code ?? null,
      error_hint: err.hint ?? null,
      vehicle_id: null,
      data: extracted,
      url,
    },
  };
}
