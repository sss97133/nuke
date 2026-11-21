/**
 * The order of a garage card's photo reel. The cover (frame one) is the database's lead-angle cover
 * (get_first_image_batch: the front three-quarter when the car has one). After it come one photo for each
 * view in REEL_SEQUENCE that the photo reading found on this car, then every other photo, newest first,
 * one page at a time as the reel is rolled. Every read goes through the shared gallery reader
 * (fetchVehicleImages), so the display gate and the signed-out source are the gallery's own.
 */
import { fetchVehicleImages } from '../../lib/fetchVehicleImages';

/** Photos read per page of the reel. */
export const REEL_PAGE = 12;

/** The views that follow the cover, in this order, when the car has one (ai_detected_angle values). */
export const REEL_SEQUENCE = ['exterior_side', 'exterior_front', 'exterior_rear', 'interior_dashboard', 'engine_bay', 'undercarriage'] as const;

export interface ReelRow { id?: string | null; image_url: string | null; is_sensitive: boolean | null; taken_at: string | null }
export interface ReelFrame { url: string; day: string | null }

const REEL_COLUMNS = 'id, image_url, is_sensitive, taken_at';

/** Rows not yet shown, in order: no sensitive photo, no URL twice, never the cover again. */
export function appendFrames(frames: ReelFrame[], rows: ReelRow[], cover: string | null): ReelFrame[] {
  const seen = new Set(frames.map(frame => frame.url));
  if (cover) seen.add(cover);
  const added: ReelFrame[] = [];
  for (const row of rows) {
    if (row.is_sensitive || typeof row.image_url !== 'string' || !row.image_url || seen.has(row.image_url)) continue;
    seen.add(row.image_url);
    added.push({ url: row.image_url, day: row.taken_at ? row.taken_at.slice(0, 10) : null });
  }
  return added.length ? [...frames, ...added] : frames;
}

/** The day the cover was taken, when a loaded row is the cover. */
export function coverDayOf(rows: ReelRow[], cover: string | null): string | null {
  const row = cover ? rows.find(candidate => candidate.image_url === cover) : undefined;
  return row?.taken_at ? row.taken_at.slice(0, 10) : null;
}

/** The first read of a reel: the sequence views (one newest photo each) and the first page of everything, newest first. */
export async function readReelStart(vehicleId: string): Promise<{ sequence: ReelRow[]; page: ReelRow[]; total: number }> {
  let total = 0;
  const [sequence, page] = await Promise.all([
    Promise.all(REEL_SEQUENCE.map(angle => fetchVehicleImages<ReelRow>(vehicleId, REEL_COLUMNS,
      { includeMismatchFilter: true, order: 'newest', angle, maxRows: 1, count: false }).catch(() => [] as ReelRow[]))),
    fetchVehicleImages<ReelRow>(vehicleId, REEL_COLUMNS, {
      includeMismatchFilter: true, order: 'newest', maxRows: REEL_PAGE, onLoadCoverage: coverage => { total = coverage.total; },
    }),
  ]);
  return { sequence: sequence.flat(), page, total: Math.max(total, page.length) };
}

/** A later page of the reel, newest first, from `offset`; `rows` past one page is one read of up to 1,000. */
export function readReelPage(vehicleId: string, offset: number, rows = REEL_PAGE): Promise<ReelRow[]> {
  return fetchVehicleImages<ReelRow>(vehicleId, REEL_COLUMNS, { includeMismatchFilter: true, order: 'newest', maxRows: rows, offset, count: false });
}

/**
 * A day square's photo: the reel holds at most this many loaded photos while it looks for a day, so a click on an
 * old square of a car with more photos than this does nothing (the gallery reader takes an offset, not a day).
 */
export const REEL_DAY_CAP = 3000;
/** Reads one click may spend looking for its day before it gives up. */
export const REEL_DAY_READS = 4;
/** The most photos one read asks for (the gallery reader's row cap). */
const REEL_DAY_READ = 1000;

/**
 * The first frame of `day` in the reel's newest-first run (frames from `runStart` on), so a swipe forward walks
 * the rest of that day; else the cover or a lead view taken that day; else -1. Indexes are into `frames`.
 */
export function dayFrameIndex(frames: ReelFrame[], day: string, runStart: number): number {
  for (let index = runStart; index < frames.length; index++) if (frames[index].day === day) return index;
  for (let index = 0; index < Math.min(runStart, frames.length); index++) if (frames[index].day === day) return index;
  return -1;
}

/**
 * How many more photos to read, from `loaded`, to reach `day` in the newest-first reel; 0 when the loaded run
 * already passed the day (or reached undated photos), nothing is left, or the cap is reached. The day reader's
 * photo counts (`days`: [day, photos, ...]) place the day: the photos of newer days come before it. The gallery
 * keeps some photos the day reader leaves out, so when that estimate falls short the read reaches further.
 */
export function dayReadSize(args: {
  day: string; lastDay: string | null | undefined; loaded: number; total: number;
  days: readonly (readonly [string, ...unknown[]])[] | null | undefined; cap?: number;
}): number {
  const { day, lastDay, loaded, total, days, cap = REEL_DAY_CAP } = args;
  // Newest first, undated last: a loaded day older than the one asked for, or an undated one, is past it.
  if (lastDay === null || (lastDay !== undefined && lastDay < day)) return 0;
  const end = Math.min(total, cap);
  if (loaded >= end) return 0;
  let before = 0;
  let on = 0;
  for (const [at, photos] of days ?? []) {
    const n = Number(photos) || 0;
    if (at > day) before += n; else if (at === day) on += n;
  }
  const estimate = before + on + REEL_PAGE;
  const want = estimate > loaded ? estimate : loaded + Math.max(REEL_PAGE, Math.ceil(loaded / 2));
  return Math.max(0, Math.min(want, end, loaded + REEL_DAY_READ) - loaded);
}
