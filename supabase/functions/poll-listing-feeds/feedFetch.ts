// Keep this fetch/error contract independent of the archive's Supabase client.
export interface CraigslistArchiveOptions {
  platform: "craigslist";
  skipCache: true;
  useFirecrawl: false;
  includeMarkdown: false;
  directFetchOptions: { publicOnly: true };
  callerName: "poll-listing-feeds";
}
export interface CraigslistArchiveResult {
  html: string | null;
  error: string | null;
  statusCode: number | null;
}

/** A zero URL count alone says nothing. Require the source's explicit empty
 * search data and its static result container before clearing a feed error. */
function isConfirmedEmptySearch(url: string, result: CraigslistArchiveResult): boolean {
  if (!result.html || result.statusCode !== 200 || result.error) return false;
  try {
    const source = new URL(url);
    if (source.protocol !== "https:" || source.username || source.password || source.port ||
      !/(^|\.)craigslist\.org$/.test(source.hostname) || !/^\/search(?:\/|$)/.test(source.pathname)) return false;
  } catch { return false; }
  const html = result.html.replace(/<!--[\s\S]*?-->/g, "");
  if (/cf_chl_opt|cf-browser-verification|\/cdn-cgi\/challenge-platform\/|access denied|403 forbidden|captcha|verify (?:that )?you are human/i.test(html) ||
    (/cloudflare/i.test(html) && /attention required|just a moment/i.test(html))) return false;
  const attr = (attributes: string, name: string): string | undefined => {
    const matching = [...attributes.matchAll(/(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)]
      .filter(attribute => attribute[1].toLowerCase() === name);
    return matching.length === 1 ? matching[0][2] ?? matching[0][3] ?? matching[0][4] : undefined;
  };
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const json = (id: string): Record<string, unknown> | null => {
    const matching = scripts.filter(script => attr(script[1], "id") === id);
    if (matching.length !== 1 || attr(matching[0][1], "type")?.toLowerCase() !== "application/ld+json") return null;
    try {
      const value = JSON.parse(matching[0][2]);
      return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch { return null; }
  };
  const page = json("ld_searchpage_data"), results = json("ld_searchpage_results");
  if (page?.["@type"] !== "SearchResultsPage" || results?.["@type"] !== "ItemList" ||
    !Array.isArray(results.itemListElement) || results.itemListElement.length !== 0) return false;
  const hasClass = (attributes: string, name: string) => attr(attributes, "class")?.split(/\s+/).includes(name);
  return [...html.matchAll(/<ol\b([^>]*)>[\s\S]*?<\/ol\s*>/gi)]
    .some(list => hasClass(list[1], "cl-static-search-results")) &&
    ![...html.matchAll(/<li\b([^>]*)>/gi)].some(item => /\bcl-static-search-result\b/.test(item[1]));
}

/** Craigslist is static HTML and its renderer refuses the domain. A failed
 * public request goes back to the existing feed backoff, never a paid fallback. */
export async function fetchCraigslistFeed(
  url: string,
  archive: (url: string, options: CraigslistArchiveOptions) => Promise<CraigslistArchiveResult>,
): Promise<{ html: string | null; error: string | null; confirmedEmpty?: true }> {
  try {
    const result = await archive(url, {
      platform: "craigslist",
      skipCache: true,
      useFirecrawl: false,
      includeMarkdown: false,
      directFetchOptions: { publicOnly: true },
      callerName: "poll-listing-feeds",
    });
    return {
      html: result.html,
      error: result.html ? null : `direct: ${result.error || `HTTP ${result.statusCode}, empty payload`}`,
      ...(isConfirmedEmptySearch(url, result) ? { confirmedEmpty: true as const } : {}),
    };
  } catch (error) {
    return { html: null, error: `direct: ${error instanceof Error ? error.message : String(error)}` };
  }
}
