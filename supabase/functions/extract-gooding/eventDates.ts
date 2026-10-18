// Dates for a Gooding listing episode (vehicle_events.ended_at / sold_at), from the lot page's auction sessions.
//
// Gooding's page-data names no lot-level sale day. It lists the auction's sessions (ContentfulSubEventAuction with a
// local startDate) and its viewings (ContentfulSubEventViewing). For every 2004–2019 auction the CMS holds a placeholder:
// one auction session at 09:00 and no viewings (lane S, 2026-10-05: 1,029 of 2,062 classified pages; Pebble Beach 2008
// reads 2008-08-01). Those days are not sale days.
// Rule: a day is written only when the page states exactly one real auction session, so every lot in the sale closed
// that day. A placeholder session, several sessions with no lot-level day, or no session all leave both dates NULL.
// The basis is returned for metadata, along with the session days the page lists.

export type GoodingSubEvent = { __typename?: string; startDate?: string | null };

export type GoodingEventDateBasis =
  | 'single_auction_session'
  | 'placeholder_session'
  | 'multiple_auction_sessions_no_lot_day'
  | 'no_auction_session';

export type GoodingEventDates = {
  ended_at: string | null;
  sold_at: string | null;
  basis: GoodingEventDateBasis;
  session_days: string[];
};

const LOCAL_DAY = /^(\d{4}-\d{2}-\d{2})/;
const LOCAL_TIME = /T(\d{2}:\d{2})/;

export function goodingEventDates(subEvents: GoodingSubEvent[] | null | undefined, sold: boolean): GoodingEventDates {
  const events = Array.isArray(subEvents) ? subEvents : [];
  const sessions = events.filter((e) =>
    e?.__typename === 'ContentfulSubEventAuction' && typeof e.startDate === 'string' && LOCAL_DAY.test(e.startDate)
  );
  const viewings = events.filter((e) => e?.__typename === 'ContentfulSubEventViewing').length;
  const session_days = [...new Set(sessions.map((s) => (s.startDate as string).match(LOCAL_DAY)![1]))].sort();

  if (sessions.length === 0) return { ended_at: null, sold_at: null, basis: 'no_auction_session', session_days };

  const time = (sessions[0].startDate as string).match(LOCAL_TIME)?.[1] ?? null;
  if (sessions.length === 1 && viewings === 0 && time === '09:00') {
    return { ended_at: null, sold_at: null, basis: 'placeholder_session', session_days };
  }
  if (session_days.length !== 1) {
    return { ended_at: null, sold_at: null, basis: 'multiple_auction_sessions_no_lot_day', session_days };
  }
  // The page's local sale day, stored at midnight UTC as the other date-only episode writers do.
  const day = new Date(`${session_days[0]}T00:00:00Z`).toISOString();
  return { ended_at: day, sold_at: sold ? day : null, basis: 'single_auction_session', session_days };
}
