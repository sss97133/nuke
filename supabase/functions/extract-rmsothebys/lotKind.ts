// Which RM Sotheby's lots are vehicles.
//
// RM's lot search lists everything an auction sells: cars, motorcycles, boats, and automobilia (luggage, badges, trophies,
// racing helmets, passports, display engines, child's cars, scale models, paintings). The extractor used to turn every
// title into a vehicle row. Measured 2026-10-14 on the 1,382 rows it wrote under rmsothebys.com/auctions/: 75 have no
// year and 47 have no make, and titles such as "1995 Gerhard Berger Ferrari Race Helmet, Signed" became year 1995, make
// "Gerhard". A year-led title is not proof of a vehicle, so the title alone cannot decide.
//
// The rule. A lot is written as a vehicle only when all three hold; the first one that fails is its skip reason.
//   1. RM's own category says it is one. SearchLots items carry categoryId. Read off 642 live lots of eight auctions
//      (MO26, MC26, LF26, PA26, AZ26, CC26, MI26, S0226) on 2026-10-14:
//        1 automobile (566)  2 automobilia (57)  3 motorcycle (10, with a scooter)  4 watercraft (1)  5 caravan (1)
//      Every luggage set, trophy, helmet, badge, passport, child's car, display engine, scale model and painting in
//      those lots is category 2, including the year-led ones. Only categories in VEHICLE_CATEGORIES are written.
//      Any other category is skipped and counted by its number, so a new one is visible and a person decides.
//   2. The title starts with a year ("1954 Buick Skylark", "c. 1904 MMC 8 HP Rear-Entrance Tonneau"), and the year the
//      writer reads from it is a plausible model year (1885 on, the repo's normalizeYear). A title with no leading year
//      is a lot of several vehicles ("Range Rover Matched Pair - 2027 Range Rover SV Ultra LWB & 1993 Range Rover
//      Classic") or one the title does not identify. A year before 1885 is not a motor vehicle's ("1858 Button & Blake
//      Hand Pumper"), and vehicles.year would take it as null.
//   3. A make follows the year.
//   Year and make are read with parseTitle and the normalizers saveVehicle writes with, so a lot that passes here lands
//   with both set. That is the stop rule "no new vehicle with a null year or make" held in code rather than by eye.
//
// Boats are not written: the vehicles table models road vehicles. Motorcycles are, as before: vehicles already holds RM
// motorcycles with canonical_vehicle_type MOTORCYCLE. Adding a category is one line in VEHICLE_CATEGORIES.
import { normalizeMake, normalizeYear } from '../_shared/normalizeVehicle.ts';
import { parseTitle } from './lotTitle.ts';

export const RM_CATEGORY_AUTOMOBILE = 1;
export const RM_CATEGORY_AUTOMOBILIA = 2;
export const RM_CATEGORY_MOTORCYCLE = 3;
export const RM_CATEGORY_WATERCRAFT = 4;

/** The categoryIds that are written. Deliberately a short allow-list: an unknown category is skipped, never guessed. */
const VEHICLE_CATEGORIES: ReadonlyMap<number, 'automobile' | 'motorcycle'> = new Map([
  [RM_CATEGORY_AUTOMOBILE, 'automobile'],
  [RM_CATEGORY_MOTORCYCLE, 'motorcycle'],
]);

export type LotSkipReason =
  | 'automobilia'
  | 'watercraft'
  | 'category_missing'
  | `category_${number}`
  | 'no_leading_year'
  | 'no_plausible_year'
  | 'no_make';

export type LotVerdict =
  | { write: true; kind: 'automobile' | 'motorcycle'; year: number; make: string }
  | { write: false; reason: LotSkipReason };

export interface LotIdentityInput {
  /** RM's categoryId (a number; anything else counts as missing). */
  categoryId?: unknown;
  /** RM's publicName, the lot's title. */
  title?: unknown;
}

// "1954 Buick Skylark" and "c. 1904 MMC 8 HP …": an optional circa mark, four digits, whitespace, then more words.
const LEADS_WITH_YEAR = /^\s*(?:c\.?\s*)?\d{4}\s+\S/i;

/** True when a title starts with a year (optionally circa) and has more words after it. */
export function leadsWithYear(title: unknown): boolean {
  return LEADS_WITH_YEAR.test(String(title ?? ''));
}

/** Year and make as the writer reads them from a title, or the reason it cannot. */
export function titleIdentity(title: unknown):
  | { year: number; make: string }
  | { reason: 'no_leading_year' | 'no_plausible_year' | 'no_make' } {
  const text = String(title ?? '');
  if (!leadsWithYear(text)) return { reason: 'no_leading_year' };
  const parsed = parseTitle(text); // the same string, the same parse, as the writer (transformLotItem)
  const year = normalizeYear(parsed.year);
  if (year === null) return { reason: 'no_plausible_year' };
  const make = normalizeMake(parsed.make);
  if (make === null) return { reason: 'no_make' };
  return { year, make };
}

/** Decide whether a lot is a vehicle to write. Pure: the same lot always gets the same verdict and reason. */
export function classifyLot(lot: LotIdentityInput): LotVerdict {
  const categoryId = typeof lot.categoryId === 'number' && Number.isFinite(lot.categoryId) ? lot.categoryId : null;
  if (categoryId === null) return { write: false, reason: 'category_missing' };
  const kind = VEHICLE_CATEGORIES.get(categoryId);
  if (!kind) {
    if (categoryId === RM_CATEGORY_AUTOMOBILIA) return { write: false, reason: 'automobilia' };
    if (categoryId === RM_CATEGORY_WATERCRAFT) return { write: false, reason: 'watercraft' };
    return { write: false, reason: `category_${categoryId}` };
  }
  const identity = titleIdentity(lot.title);
  if ('reason' in identity) return { write: false, reason: identity.reason };
  return { write: true, kind, year: identity.year, make: identity.make };
}

export interface SkippedLot {
  lot_number: string | null;
  title: string;
  reason: LotSkipReason;
}

export interface LotPartition<T> {
  /** Lots to write, in the order RM listed them. */
  writable: T[];
  skipped: SkippedLot[];
  /** Skip counts by reason. */
  skipped_by_reason: Record<string, number>;
}

/** Split an auction's lots into those written and those skipped, counting the skips by reason. */
export function partitionLots<T extends { title: string; lot_number?: string | null; category_id: number | null }>(
  lots: readonly T[],
): LotPartition<T> {
  const writable: T[] = [];
  const skipped: SkippedLot[] = [];
  const skipped_by_reason: Record<string, number> = {};
  for (const lot of lots) {
    const verdict = classifyLot({ categoryId: lot.category_id, title: lot.title });
    if (verdict.write) {
      writable.push(lot);
      continue;
    }
    skipped.push({ lot_number: lot.lot_number ?? null, title: lot.title, reason: verdict.reason });
    skipped_by_reason[verdict.reason] = (skipped_by_reason[verdict.reason] ?? 0) + 1;
  }
  return { writable, skipped, skipped_by_reason };
}
