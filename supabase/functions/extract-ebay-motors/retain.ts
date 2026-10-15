/**
 * Read one eBay page through Firecrawl and retain the response before anything parses it: the body goes to the
 * listing-snapshots bucket and a listing_page_snapshots row points at it (html_storage_path / markdown_storage_path; the
 * table's convention for large pages, so a 4.8 MB search page is not a database column). Same pattern as extract-bonhams.
 */
import { firecrawlScrape } from "../_shared/firecrawl.ts";

export interface FetchedPage { html: string | null; markdown: string | null; snapshotId: string | null; error: string | null; statusCode: number | null }
export type PageFetcher = (url: string, opts: { markdown: boolean; metadata: Record<string, unknown> }) => Promise<FetchedPage>;

const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource))).map((x) => x.toString(16).padStart(2, "0")).join("");

export function firecrawlFetcher(supabase: any, platform: string): PageFetcher {
  return async (url, { markdown, metadata }) => {
    const fc = await firecrawlScrape({ url, formats: markdown ? ["html", "markdown"] : ["html"], onlyMainContent: false, waitFor: 2500 });
    const status = Number(fc.raw?.data?.metadata?.statusCode ?? fc.httpStatus ?? 0) || null;
    const html = fc.data.html ?? null, md = fc.data.markdown ?? null;
    if (!html) return { html: null, markdown: null, snapshotId: null, error: fc.error ?? "empty page", statusCode: status };

    const bytes = new TextEncoder().encode(html);
    const sha = await hex(bytes);
    const base = `${platform}/${new Date().toISOString().slice(0, 10)}`;
    const up = await supabase.storage.from("listing-snapshots").upload(`${base}/${sha}.html`, bytes, { contentType: "text/html", upsert: true });
    if (up.error) return { html, markdown: md, snapshotId: null, error: `snapshot storage failed: ${up.error.message}`, statusCode: status };
    let mdPath: string | null = null;
    if (md) {
      const mb = new TextEncoder().encode(md);
      const mu = await supabase.storage.from("listing-snapshots").upload(`${base}/${await hex(mb)}.md`, mb, { contentType: "text/markdown", upsert: true });
      if (mu.error) return { html, markdown: md, snapshotId: null, error: `snapshot storage failed: ${mu.error.message}`, statusCode: status };
      mdPath = `${base}/${await hex(mb)}.md`;
    }
    const row = {
      platform, listing_url: url, fetched_at: new Date().toISOString(), fetch_method: "firecrawl", http_status: status, success: status === 200,
      html: null, html_storage_path: `${base}/${sha}.html`, markdown: null, markdown_storage_path: mdPath, html_sha256: sha, content_length: bytes.length,
      metadata: { ...metadata, caller: "extract-ebay-motors", credits: 1 },
    };
    const ins = await supabase.from("listing_page_snapshots").insert(row).select("id").maybeSingle();
    let id: string | null = ins.data?.id ?? null;
    if (ins.error) {
      if (String(ins.error.code) !== "23505") return { html, markdown: md, snapshotId: null, error: `snapshot row failed: ${ins.error.message}`, statusCode: status };
      const ex = await supabase.from("listing_page_snapshots").select("id").eq("platform", platform).eq("listing_url", url).eq("html_sha256", sha).limit(1).maybeSingle();
      id = ex.data?.id ?? null;
    }
    return { html, markdown: md, snapshotId: id, error: null, statusCode: status };
  };
}
