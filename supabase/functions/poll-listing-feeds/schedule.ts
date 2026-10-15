/**
 * Craigslist feed schedule: spend requests where new posts are.
 *
 * Measured 2026-10-15: 93% of the URLs on a Craigslist search page are already known, so polling every metro at the
 * same rate mostly re-reads old pages. Each poll records how many posts on the page were new (`fresh`), and the feed's
 * own poll interval follows its rate of new posts: about one poll per two new posts, between 10 minutes and 6 hours.
 * A quiet metro backs off to hours; a busy one is read on every run. The rate is an exponential average per hour, kept
 * on the feed row (listing_feeds.new_rate_per_hour, last_new_count).
 *
 * Tier (search_criteria.tier) orders the due feeds: 1 = private party 1964-1973, 2 = private party 1974-1991,
 * 3 = the rest of 1960-1999, 4 = dealer posts, 5 = all other years. A lower tier is always selected first.
 */

export const MIN_INTERVAL_MIN = 10;
export const MAX_INTERVAL_MIN = 360;
export const TARGET_NEW_PER_POLL = 2;
const SMOOTHING = 0.4;

export interface FeedYield {
  /** New posts per hour, smoothed; null before the first reading. */
  rate: number | null;
  interval_minutes: number;
}

/**
 * The next yield state after a poll that found `fresh` new posts `hoursSince` hours after the previous poll.
 * A first reading, or a gap under 10 minutes, is read as if it had been 10 minutes.
 */
export function nextYield(prev: number | null | undefined, fresh: number, hoursSince: number | null): FeedYield {
  const hours = Math.max(hoursSince && Number.isFinite(hoursSince) ? hoursSince : MIN_INTERVAL_MIN / 60, MIN_INTERVAL_MIN / 60);
  const observed = Math.max(0, fresh) / hours;
  const rate = prev === null || prev === undefined || !Number.isFinite(prev) ? observed : (1 - SMOOTHING) * prev + SMOOTHING * observed;
  const wanted = rate > 0 ? Math.round((60 * TARGET_NEW_PER_POLL) / rate) : MAX_INTERVAL_MIN;
  return { rate: Math.round(rate * 1000) / 1000, interval_minutes: Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, wanted)) };
}

export function tierOf(feed: { search_criteria?: { tier?: unknown } | null }): number {
  const t = Number(feed.search_criteria?.tier);
  return Number.isInteger(t) && t >= 1 && t <= 9 ? t : 9;
}
