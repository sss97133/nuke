// The sale date of a Barrett-Jackson lot, from its captured page.
//
// A docket page's RSC payload carries several "start_date" values: the lot's own event and the house's upcoming events
// advertised around it. Taking the first one dated a 2004 Scottsdale lot to 2026-04-16 (Palm Beach 2026, on a page
// captured in February 2026; found 2026-10-16 on a re-land). The docket URL names the lot's event and year
// (/scottsdale-2004/docket/...), so a start_date counts only when its year is that event's year. No year in the URL, or
// no start_date in that year, is an unknown date, not a guess.

/** The year of the event a docket URL names (/scottsdale-2004/, /scottsdale-fall-2025/), or null. */
export function docketEventYear(url: string): string | null {
  return url.match(/barrett-jackson\.com\/[a-z-]+-(\d{4})\//i)?.[1] ?? null;
}

/** The first start_date in the page whose year is the docket's event year, or null. */
export function lotEventDate(html: string, url: string): string | null {
  const year = docketEventYear(url);
  if (!year) return null;
  for (const m of html.matchAll(/\\?"start_date\\?":\s*\\?"(\d{4}-\d{2}-\d{2})/g)) {
    if (m[1].startsWith(year)) return m[1];
  }
  return null;
}
