// Mecum's existing public, search-only index. JSON API reads do not use archiveFetch.
export const ALGOLIA_APP = "U6CFCQ7V52";
export const ALGOLIA_INDEX = "wp_posts_lot";
const ALGOLIA_SEARCH_KEY = "0291c46cde807bcb428a021a96138fcb";

/** Refusals and malformed replies must never become an empty roster. */
export async function mecumSearch(params: string, request: typeof fetch = fetch): Promise<any> {
  const response = await request(`https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/*/queries`, { // guardrail-allow: raw-fetch (public JSON search API)
    method: "POST",
    headers: { "x-algolia-application-id": ALGOLIA_APP, "x-algolia-api-key": ALGOLIA_SEARCH_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ indexName: ALGOLIA_INDEX, params }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`mecum_index: HTTP ${response.status}`);
  const body = await response.json();
  const result = body?.results?.[0];
  if (!result || typeof result !== "object" || result.message) throw new Error("mecum_index: invalid result");
  return result;
}

/** One bounded page for the nearest three current/upcoming sales. This is feed
 * discovery, not a complete source census. Existing ingestion limits still apply. */
export async function fetchMecumFeedUrls(
  search = mecumSearch, now = Date.now(),
): Promise<{ urls: string[]; confirmedEmpty: boolean }> {
  const facetName = "taxonomies.auction_tax.name";
  const facetResult = await search(new URLSearchParams({ hitsPerPage: "0", facets: JSON.stringify([facetName]), maxValuesPerFacet: "1000" }).toString());
  const facets = facetResult.facets?.[facetName];
  if (!facets || typeof facets !== "object" || Array.isArray(facets)) throw new Error("mecum_index: missing sale facets");
  const sales = Object.entries(facets).filter(([value, count]) => {
    const parts = value.split("|");
    return parts.length === 3 && Number.isFinite(Number(parts[1])) && Number.isFinite(Number(parts[2])) &&
      Number(parts[2]) >= Math.floor(now / 1000) && typeof count === "number" && count > 0;
  }).sort(([a], [b]) => Number(a.split("|")[1]) - Number(b.split("|")[1]) || a.localeCompare(b)).slice(0, 3);
  if (!sales.length) return { urls: [], confirmedEmpty: true };
  const filters = sales.map(([sale]) => `${facetName}:${JSON.stringify(sale)}`).join(" OR ");
  const result = await search(new URLSearchParams({ hitsPerPage: "300", filters,
    attributesToRetrieve: JSON.stringify(["permalink", "taxonomies.division_tax"]),
    attributesToHighlight: "[]", attributesToSnippet: "[]" }).toString());
  if (!Array.isArray(result.hits) || !result.hits.length) throw new Error("mecum_index: missing listed lots");
  const urls = new Set<string>();
  for (const hit of result.hits.slice(0, 300)) {
    if (!hit || typeof hit.permalink !== "string") continue;
    const divisions = hit.taxonomies?.division_tax ?? [];
    if (!Array.isArray(divisions) || divisions.some((division: any) => division?.slug === "road-art" || division?.name === "Road Art")) continue;
    let url: URL;
    try { url = new URL(hit.permalink, "https://www.mecum.com"); } catch { continue; }
    if (url.origin !== "https://www.mecum.com" || url.username || url.password || url.search || url.hash ||
      !/^\/lots\/\d+\/[a-z0-9-]+\/?$/.test(url.pathname)) continue;
    urls.add(url.href.replace(/\/$/, ""));
  }
  if (!urls.size) throw new Error("mecum_index: no vehicle lot URLs");
  return { urls: [...urls], confirmedEmpty: false };
}
