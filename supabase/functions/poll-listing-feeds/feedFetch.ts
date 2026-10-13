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

/** Craigslist is static HTML and its renderer refuses the domain. A failed
 * public request goes back to the existing feed backoff, never a paid fallback. */
export async function fetchCraigslistFeed(
  url: string,
  archive: (url: string, options: CraigslistArchiveOptions) => Promise<CraigslistArchiveResult>,
): Promise<{ html: string | null; error: string | null }> {
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
    };
  } catch (error) {
    return { html: null, error: `direct: ${error instanceof Error ? error.message : String(error)}` };
  }
}
