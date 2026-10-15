// One Gooding lot is one URL, whichever host spelling the writer saw. The site answers on goodingco.com and www.goodingco.com,
// and 638 lots (2026-10-15) ended up on two vehicles, one per host, because a writer that found no vehicle under its own spelling
// inserted a second. These are the spellings to look under before inserting. Pure; tested in lotUrl.test.ts.

/** The lot slug of a Gooding lot URL, or null for anything else. */
export function goodingSlug(url: string | null | undefined): string | null {
  const m = String(url ?? '').match(/^https?:\/\/(?:www\.)?goodingco\.com\/lot\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Every spelling a vehicle's discovery_url may hold for this lot: both hosts, with and without a trailing slash. */
export function goodingUrlVariants(url: string): string[] {
  const slug = goodingSlug(url);
  if (!slug) return [url];
  const out: string[] = [];
  for (const host of ['https://goodingco.com', 'https://www.goodingco.com']) {
    out.push(`${host}/lot/${slug}`, `${host}/lot/${slug}/`);
  }
  return out;
}
