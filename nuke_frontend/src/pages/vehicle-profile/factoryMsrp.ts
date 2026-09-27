/**
 * The sticker price, or nothing.
 *
 * enrich-msrp's former Strategy 3 wrote a model's resale median into
 * vehicles.msrp with msrp_source 'ai_estimated' (a 1% sample finds 234 rows, so
 * about 23,400 cars; avg $61,247 against OEM rows' $46,468). A resale median is
 * not an MSRP, so the page never shows one as "Original MSRP". Every other
 * source — oem, listing_parsed, user, or none recorded — shows. The writer was
 * removed in 00769f9e2; the rows stay until they are superseded.
 */
export function factoryMsrp(v: { msrp?: number | null; msrp_source?: string | null } | null | undefined): number | null {
  if (!v || typeof v.msrp !== 'number' || Number.isNaN(v.msrp)) return null;
  return v.msrp_source === 'ai_estimated' ? null : v.msrp;
}
