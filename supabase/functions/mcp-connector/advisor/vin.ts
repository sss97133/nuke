/**
 * Decide whether a find_asset query is a VIN / chassis number or free text.
 * Free text like "1972 Chevy C10" must go to text search, never to a VIN lookup or NHTSA decode.
 */

const VIN17 = /^[A-HJ-NPR-Z0-9]{17}$/i;
// Pre-1981 chassis numbers vary by maker (VW 1442612348, Chevy CE142S123456, Porsche 9113600123):
// 8-13 chars, no I/O/Q, mostly digits.
const PRE1981 = /^[A-HJ-NPR-Z0-9]{8,13}$/i;

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** North American check digit (position 9). Non-NA makers often skip it, so invalid is a flag, not a rejection. */
export function vinCheckDigitValid(vin: string): boolean {
  const v = vin.toUpperCase();
  if (!VIN17.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = v[i]!;
    const n = /\d/.test(ch) ? Number(ch) : TRANSLIT[ch];
    if (n == null) return false;
    sum += n * WEIGHTS[i]!;
  }
  const r = sum % 11;
  const expect = r === 10 ? "X" : String(r);
  return v[8] === expect;
}

export type VinQuery =
  | { kind: "vin17"; vin: string; check_digit_valid: boolean }
  | { kind: "chassis"; vin: string }
  | { kind: "text" };

export function classifyVinQuery(raw: string): VinQuery {
  const q = String(raw || "").trim();
  // Any internal whitespace means words ("1972 Chevy C10"), not a VIN.
  if (!q || /\s/.test(q)) return { kind: "text" };
  const up = q.toUpperCase();
  if (VIN17.test(up)) return { kind: "vin17", vin: up, check_digit_valid: vinCheckDigitValid(up) };
  if (PRE1981.test(up)) {
    const digits = (up.match(/\d/g) || []).length;
    const letters = up.length - digits;
    if (digits >= 6 && letters <= 4) return { kind: "chassis", vin: up };
  }
  return { kind: "text" };
}
