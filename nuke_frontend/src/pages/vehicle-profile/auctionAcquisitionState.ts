import { houseLink, houseName, saleTimer } from '../market/useAuctionCalendar';

export interface AcquisitionEpisode {
  id: string; event_type: string; event_status: string; source_platform: string; source_url: string;
  source_organization_id?: string | null; duplicate_of_event_id?: string | null;
  metadata?: Record<string, unknown> | null;
}
const day = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
};

/** The typed source appearance establishes an offer, never ownership or a completed sale.
 * Run-day metadata stays at day precision; passing a schedule cannot resolve an outcome. */
export function auctionAcquisitionState(event: AcquisitionEpisode, now = Date.now()) {
  const sourceUrl = houseLink(event.source_platform, event.source_url);
  if (event.duplicate_of_event_id || event.event_type !== 'auction' || !sourceUrl) return null;
  const meta = event.metadata ?? {};
  const startsOn = day(meta.sale_starts_on), endsOn = day(meta.sale_ends_on);
  const scheduled = startsOn && endsOn && startsOn <= endsOn ? { startsOn, endsOn } : null;
  // Don't turn every historical auction into a current acquisition candidate.
  if (!['upcoming', 'pending', 'scheduled'].includes(event.event_status) && !scheduled) return null;
  const runOn = Array.isArray(meta.auction_session_days) ? meta.auction_session_days.map(day).filter((d): d is string => d !== null
    && (!scheduled || d >= scheduled.startsOn && d <= scheduled.endsOn)).sort() : [];
  const timer = runOn.length ? saleTimer(runOn[0], runOn[runOn.length - 1], now)
    : scheduled ? saleTimer(scheduled.startsOn, scheduled.endsOn, now) : null;
  const terminal = ['sold', 'no_sale', 'unsold', 'reserve_not_met', 'withdrawn', 'cancelled', 'canceled'].includes(event.event_status);
  const stage = terminal ? event.event_status === 'sold' ? 'Sold' : ['withdrawn', 'cancelled', 'canceled'].includes(event.event_status)
    ? 'Withdrawn' : 'Not sold' : timer === 'ended' ? 'Awaiting auction result' : timer?.startsWith('running')
    ? 'Auction dates underway · offered for sale' : 'Upcoming auction · offered for sale';
  return { sourceUrl, house: houseName(event.source_platform), stage, resolved: terminal,
    timer: terminal || timer === 'ended' ? null : timer,
    scheduled, lot: typeof meta.lot_number === 'string' ? meta.lot_number : null,
    name: typeof meta.auction_name === 'string' ? meta.auction_name : houseName(event.source_platform),
    location: typeof meta.sale_location === 'string' ? meta.sale_location : null,
    observedAt: typeof meta.source_observed_at === 'string' ? meta.source_observed_at : null,
    runOn,
  };
}
