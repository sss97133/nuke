/**
 * Parse the BaT seller location from the BaT Essentials block. Two layouts seen in real snapshots:
 *   older:  `Location: <a href="...">Austin, Texas 78701</a>`
 *   2026+:  `<strong>Location</strong>: <a href="https://www.google.com/maps/...">Murfreesboro, Tennessee 37129</a>`
 * The country-only nav block (`<strong class="group-title-label">Location</strong>Located in United States`) has no
 * colon + link, so it is ignored, as is free text like "Location: Griot's Garage" in event blurbs (no link).
 */
export interface SellerLocation { location_raw: string; city: string | null; region: string | null; country: string | null; zip: string | null }
const US_STATES = new Set(["Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia","Wisconsin","Wyoming","District of Columbia"]);
export function parseBatLocation(html: string): SellerLocation | null {
  const m = html.match(/Location(?:<\/strong>)?\s*:\s*(?:<\/strong>)?\s*<a[^>]*>([^<]+)<\/a>/i);
  if (!m) return null;
  const raw = m[1].replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim());
  const city = parts.length > 1 ? parts[0] : null;
  let rest = parts.length > 1 ? parts.slice(1).join(", ") : parts[0];
  const zm = rest.match(/\s(\d{5})(?:-\d{4})?$/);
  const zip = zm ? zm[1] : null;
  if (zm) rest = rest.slice(0, zm.index).trim();
  const isUS = US_STATES.has(rest) || !!zip;
  return { location_raw: raw, city, region: rest || null, country: isUS ? "US" : (parts.length > 2 ? parts[parts.length - 1] : null), zip };
}
