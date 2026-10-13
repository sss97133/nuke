import type { ArchiveFetchOptions, ArchiveFetchResult } from "../_shared/archiveFetch.ts";

/** Craigslist is static HTML and its renderer refuses the domain. A failed
 * public request goes back to the existing feed backoff, never a paid fallback. */
export async function fetchCraigslistFeed(
  url: string,
  archive: (url: string, options: ArchiveFetchOptions) => Promise<ArchiveFetchResult>,
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
