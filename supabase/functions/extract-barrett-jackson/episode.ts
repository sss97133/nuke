// A Barrett-Jackson lot read before its sale says lot_number "Preview" and is_sold false. That is an upcoming lot,
// not a lot that failed to sell: 652 of the 653 B-J episodes holding lot "Preview" were stored 'unsold' (2026-10-18),
// e.g. the 2026 Palm Beach Camaro RS lot 487 that sold. Pure; tested in episode.test.ts.

/** The lot number a docket states, or null for the "Preview" placeholder of an unnumbered lot. */
export function docketLotNumber(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v || /^preview$/i.test(v)) return null;
  return v;
}

/** The docket's result: is_sold true is Sold; false is Not Sold only for a numbered lot, and Upcoming on a preview. */
export function docketStatus(isSold: boolean, rawLotNumber: string | null | undefined): 'Sold' | 'Not Sold' | 'Upcoming' {
  if (isSold) return 'Sold';
  return docketLotNumber(rawLotNumber) === null && /^preview$/i.test((rawLotNumber ?? '').trim()) ? 'Upcoming' : 'Not Sold';
}

export type EpisodeStatus = 'sold' | 'unsold' | 'cancelled' | 'pending' | 'ended';

export function episodeStatus(status: string | null | undefined): EpisodeStatus {
  const s = (status ?? '').toLowerCase();
  if (s === 'sold') return 'sold';
  if (s === 'not sold') return 'unsold';
  if (s === 'withdrawn') return 'cancelled';
  if (s === 'upcoming') return 'pending';
  return 'ended';
}

/** A read that states a result (sold, not sold, withdrawn), so it may replace what an earlier read stored. */
export function statesResult(status: string | null | undefined): boolean {
  return ['sold', 'unsold', 'cancelled'].includes(episodeStatus(status));
}

/** sold_at is the sale day, so only a sold lot has one. */
export function episodeSoldAt(status: string | null | undefined, eventDate: string | null | undefined): string | null {
  if (episodeStatus(status) !== 'sold' || !eventDate || isNaN(Date.parse(eventDate))) return null;
  return new Date(eventDate).toISOString();
}
