/**
 * eyeShape — normalize appraise-payload fields whose shape drifted between
 * method versions. The overnight v1.3 reads emitted drivers/risks/flip_plan as
 * plain strings; the canon_v2 (v1.4+) appraiser the RUNNER produces emits them
 * as richer objects ({driver, findings[]}, {risk, findings[]}, a structured
 * flip_plan) and an if_it_verifies with different keys. Rendering an object as
 * a React child crashes the whole page, so every value surface reads the
 * payload through these normalizers — tolerant of both shapes, forever.
 */

export interface Point { text: string; refs: string[] }

/** drivers/risks: item is a string, or {driver|risk, findings[]}. */
export function normalizePoints(arr: any, kind: 'driver' | 'risk'): Point[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => {
    if (typeof it === 'string') return { text: it, refs: [] };
    if (it && typeof it === 'object') {
      const text = it[kind] ?? it.text ?? it.point ?? it.note ?? '';
      const refs = Array.isArray(it.findings) ? it.findings.map(String)
        : Array.isArray(it.refs) ? it.refs.map(String) : [];
      return { text: String(text), refs };
    }
    return { text: String(it ?? ''), refs: [] };
  }).filter((p) => p.text);
}

/** what_would_change_the_number: strings, or {text/change, ...}. */
export function normalizeStrings(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((it) => typeof it === 'string' ? it
    : (it && typeof it === 'object' ? String(it.text ?? it.change ?? it.what ?? it.note ?? JSON.stringify(it)) : String(it ?? '')))
    .filter(Boolean);
}

export interface Iiv { low: number | null; high: number | null; note: string | null; precedents: string[] }

/** if_it_verifies: {band_usd:{low,high}, note, condition_precedent[]} OR {band_low, band_high, condition, cap_reason}. */
export function normalizeIiv(iiv: any): Iiv | null {
  if (!iiv || typeof iiv !== 'object') return null;
  const low = iiv.band_usd?.low ?? iiv.band_low ?? null;
  const high = iiv.band_usd?.high ?? iiv.band_high ?? null;
  const note = iiv.note ?? iiv.condition ?? null;
  const precedents = Array.isArray(iiv.condition_precedent) ? iiv.condition_precedent.map(String)
    : iiv.cap_reason ? [String(iiv.cap_reason)] : [];
  if (low == null && high == null && !note && !precedents.length) return null;
  return { low: low != null ? Number(low) : null, high: high != null ? Number(high) : null, note: note ? String(note) : null, precedents };
}

/** flip_plan: a string, or a structured object. Returns display lines. */
export function normalizeFlipPlan(fp: any): { label: string; value: string }[] {
  if (!fp) return [];
  if (typeof fp === 'string') return [{ label: '', value: fp }];
  if (typeof fp === 'object') {
    const LABELS: Record<string, string> = {
      what_to_fix_or_verify: 'Fix / verify', est_cost_class: 'Cost class',
      what_the_car_becomes: 'Becomes', reachability: 'Reachability',
    };
    return Object.entries(fp)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => ({ label: LABELS[k] || k.replace(/_/g, ' '), value: typeof v === 'string' ? v : JSON.stringify(v) }));
  }
  return [];
}
