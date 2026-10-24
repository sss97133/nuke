// Mileage from a Cars & Bids og:title ("2002 BMW M3 ~14,000 Miles - ..."). The title carries the
// odometer, so only obvious non-odometer uses are dropped via _shared/odometerText.ts.
import { isNonOdometerMention } from "../_shared/odometerText.ts";

export function mileageFromCabTitle(title: string | null | undefined): number | null {
  if (!title) return null;
  for (const m of title.matchAll(/~?(\d{1,3}(?:,\d{3})+|\d{1,7})\s*Miles\b/gi)) {
    if (isNonOdometerMention(title, m.index ?? 0, m[0].length)) continue;
    const miles = parseInt(m[1].replace(/,/g, ""), 10);
    if (miles > 0) return miles;
  }
  return null;
}
