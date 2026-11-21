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

/** A later page of the reel, newest first, from `offset`. */
export function readReelPage(vehicleId: string, offset: number): Promise<ReelRow[]> {
  return fetchVehicleImages<ReelRow>(vehicleId, REEL_COLUMNS, { includeMismatchFilter: true, order: 'newest', maxRows: REEL_PAGE, offset, count: false });
}
