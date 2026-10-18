// Does an incoming lot describe the same car as the vehicle it was resolved to? Used before a writer puts a lot's
// identity fields, photos or episodes on an existing vehicle. Identity fields (year, make, model, vin) on a resolved
// vehicle are fill-only; when the incoming lot disagrees, the write is refused and a revision item is recorded
// (missing: identity_match, reason: different_car, next action: relink). Pure; tested in identityMatch.test.ts.
// Cause: extract-barrett-jackson resolved a vehicle by VIN or URL and overwrote it with the docket car, so a BaT 1967
// Chevrolet custom sport truck (50caf39a) carried a Corvette 427/435 VIN, a B-J URL and B-J photos (2026-10-15).

export interface Identity {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  vin?: string | null;
}

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const vinKey = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** First model word that carries meaning ("corvette 427/435" -> "corvette"); numbers-only tokens are not a model. */
function modelWords(model: string): string[] {
  return norm(model).split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w));
}

/** null when the lot may be the same car; otherwise why not. Missing values never disagree (fill-only). */
export function identityConflict(existing: Identity, incoming: Identity): string | null {
  const ev = vinKey(existing.vin);
  const iv = vinKey(incoming.vin);
  if (ev && iv && ev !== iv) return `vin ${ev} vs ${iv}`;
  if (existing.make && incoming.make && norm(existing.make) !== norm(incoming.make)) return `make ${norm(existing.make)} vs ${norm(incoming.make)}`;
  if (existing.year && incoming.year && Math.abs(Number(existing.year) - Number(incoming.year)) > 1) return `year ${existing.year} vs ${incoming.year}`;
  if (existing.model && incoming.model) {
    const a = modelWords(existing.model);
    const b = modelWords(incoming.model);
    // Different when both name a model and share no word ("custom sport truck" vs "corvette 427/435").
    if (a.length && b.length && !a.some((w) => b.includes(w))) return `model ${norm(existing.model)} vs ${norm(incoming.model)}`;
  }
  return null;
}

export const IDENTITY_FIELDS = ['year', 'make', 'model', 'vin'] as const;

/** An update payload with identity fields kept only where the vehicle has none. */
export function fillOnlyIdentity<T extends Record<string, unknown>>(update: T, existing: Identity): T {
  const out: Record<string, unknown> = { ...update };
  for (const f of IDENTITY_FIELDS) {
    const have = existing[f];
    if (have !== null && have !== undefined && String(have).trim() !== '') delete out[f];
  }
  return out as T;
}

// revision_reason must be in import_queue_revision_vocab; a different car is bad_data on identity_match (as the Bonhams,
// Broad Arrow, Gooding and eBay writers file it). 'different_car' was refused by that constraint on every insert.
export const REVISION_DIFFERENT_CAR = { missing: 'identity_match', reason: 'bad_data', next_action: 'relink' } as const;
