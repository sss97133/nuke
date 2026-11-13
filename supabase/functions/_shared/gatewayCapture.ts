import { readArchivedPage } from "./archiveFetch.ts";

/** A fresh browser visit may reuse an unchanged retained body. Keep the visit
 * clock separate from the snapshot's first capture clock and verify both. */
export async function readGatewayBrowserCapture(db: any, url: string, inventory = false, maxAgeSec = 86400, read = readArchivedPage) {
  const runs = await db.from("extraction_runs").select("id,source,status,started_at,completed_at,metadata")
    .eq("source", "gateway-browser").gte("started_at", new Date(Date.now() - maxAgeSec * 1000).toISOString())
    .order("started_at", { ascending: false }).limit(2);
  if (runs.error || !Array.isArray(runs.data)) throw Error("gateway_browser_progress_unavailable");
  for (const run of runs.data) {
    if (inventory && run.status !== "completed") throw Error("gateway_browser_run_incomplete");
    if (run.metadata?.profile !== "public_gateway_browser_v1" || run.metadata.feed_id !== "c68aa94a-68aa-475b-847d-4b0672e7beee") continue;
    const witness = run.metadata.pages?.find((p: any) => p.url === url && p.inventory === inventory);
    if (!witness) continue;
    const observed = Date.parse(witness.observed_at);
    if (!Number.isFinite(observed) || observed < Date.parse(run.started_at) || observed > Date.now()
      || (run.completed_at && observed > Date.parse(run.completed_at)) || witness.http_status !== 200) throw Error("gateway_browser_clock_invalid");
    const snapshotId = witness.capture?.snapshot_id;
    const page = await read(url, { platform: "gateway_classics", snapshotId, htmlOnly: true });
    if (!snapshotId || !page.html || page.snapshotId !== snapshotId) throw Error("gateway_browser_capture_required");
    const snapshot = await db.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,html_sha256,success,http_status,metadata")
      .eq("id", snapshotId).maybeSingle();
    const s = snapshot.data;
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(page.html)))].map(v => v.toString(16).padStart(2, "0")).join("");
    if (snapshot.error || !s || s.platform !== "gateway_classics" || s.listing_url !== url || !s.success || s.http_status !== 200
      || s.metadata?.browser_rendered_dom !== true || s.html_sha256 !== hash || witness.capture.html_sha256 !== hash
      || !Number.isFinite(Date.parse(s.fetched_at)) || Date.parse(s.fetched_at) > observed) throw Error("gateway_browser_capture_mismatch");
    return { html: page.html, snapshot_id: snapshotId, snapshot_fetched_at: s.fetched_at, observed_at: witness.observed_at, hash, run_id: run.id, captured_urls: run.metadata.pages.filter((p: any) => !p.inventory && p.capture?.snapshot_id).map((p: any) => p.url) };
  }
  throw Error("gateway_browser_capture_required");
}
