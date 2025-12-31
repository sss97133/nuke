export interface ExternalListingLike {
	listing_status?: string | null;
	end_date?: string | null;
	current_bid?: number | string | null;
	final_price?: number | string | null;
}

/**
 * Returns true if the listing should be considered live.
 * Logic:
 * - If end_date exists and is in the future → live
 * - If end_date is missing but status is 'active' or 'live' → live
 */
export function isListingLive(listing: ExternalListingLike | null | undefined): boolean {
	if (!listing) return false;
	const endDateMs = listing.end_date ? new Date(listing.end_date).getTime() : NaN;
	const status = String(listing.listing_status || '').toLowerCase();
	const hasLiveStatus = status === 'active' || status === 'live';
	const hasFutureEnd = Number.isFinite(endDateMs) && endDateMs > Date.now();
	return Boolean(hasFutureEnd || (!listing.end_date && hasLiveStatus));
}

export function parseMoneyNumber(value: number | string | null | undefined): number | null {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
	if (typeof value === 'string') {
		const n = Number(value.replace?.(/[^\d.]/g, '') ?? value);
		return Number.isFinite(n) && n > 0 ? n : null;
	}
	return null;
}



