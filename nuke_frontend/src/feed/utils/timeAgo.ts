/**
 * timeAgo — Human-readable relative timestamps.
 *
 * "2h ago", "3d ago", "sold 2y ago", "listed 5m ago"
 * Makes data feel alive.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Convert a date string/number to a compact relative time string.
 * Returns null if the input is invalid.
 */
export function timeAgo(date: string | number | null | undefined): string | null {
  if (!date) return null;
  const ts = typeof date === 'number' ? date : new Date(date).getTime();
  if (!Number.isFinite(ts)) return null;

  const diff = Date.now() - ts;
  if (diff < 0) return 'just now'; // future dates

  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w ago`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo ago`;
  const years = Math.floor(diff / YEAR);
  return years === 1 ? '1y ago' : `${years}y ago`;
}

/**
 * Build a contextual time label for a vehicle.
 * e.g. "sold 3y ago", "listed 2h ago", "added 5d ago"
 */
export function vehicleTimeLabel(vehicle: {
  sale_date?: string | null;
  created_at?: string | null;
  auction_end_date?: string | null;
  listing_status?: string | null;
  is_for_sale?: boolean;
}): string | null {
  // Sold vehicles: show when sold
  if (vehicle.sale_date) {
    const ago = timeAgo(vehicle.sale_date);
    return ago ? `sold ${ago}` : null;
  }

  // Active auctions: show when ending
  if (vehicle.auction_end_date && vehicle.listing_status === 'active') {
    const end = new Date(vehicle.auction_end_date).getTime();
    if (Number.isFinite(end)) {
      const diff = end - Date.now();
      if (diff > 0) {
        if (diff < HOUR) return `ends ${Math.floor(diff / MINUTE)}m`;
        if (diff < DAY) return `ends ${Math.floor(diff / HOUR)}h`;
        return `ends ${Math.floor(diff / DAY)}d`;
      }
    }
  }

  // For-sale listings: show when listed
  if (vehicle.is_for_sale && vehicle.created_at) {
    const ago = timeAgo(vehicle.created_at);
    return ago ? `listed ${ago}` : null;
  }

  // Default: show when added
  if (vehicle.created_at) {
    const ago = timeAgo(vehicle.created_at);
    return ago ? `added ${ago}` : null;
  }

  return null;
}
