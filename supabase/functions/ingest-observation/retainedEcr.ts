import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

export const ECR_MODE = "retained_ecr_capture_v1";
export const ECR_METHOD = "protected_retained_ecr_capture_v1";
export const ECR_SOURCE = "exclusive-car-registry";
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const refuse = (reason: string) => ({ ok: false as const, reason });
export function ecrSelector(body: Record<string, unknown>) {
  return body.mode === ECR_MODE && typeof body.snapshot_id === "string" && UUID.test(body.snapshot_id)
    && typeof body.dry_run === "boolean" && Object.keys(body).every(k => ["mode", "snapshot_id", "dry_run"].includes(k))
    ? body.snapshot_id.toLowerCase() : null;
}
export function ecrUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.hostname !== "exclusivecarregistry.com" || u.port || u.username || u.password || u.search || u.hash) return null;
    const path = u.pathname.replace(/\/$/, "");
    if (!/^\/(collection\/[a-z0-9_-]+|details\/[a-z0-9_-]+\/[a-z0-9_-]+\/[1-9][0-9]*)$/i.test(path)) return null;
    return `https://exclusivecarregistry.com${path}`;
  } catch { return null; }
}
export async function parseEcr(html: string, sourceUrl: string) {
  const url = ecrUrl(sourceUrl);
  if (!url) return refuse("unsupported_ecr_page");
  // The shared intake serves many unrelated paths. Load this existing parser
  // dependency only when an ECR snapshot is actually qualified.
  const { load } = await import("npm:cheerio@1.2.0");
  const $ = load(html);
  const main = $("main");
  const headings = main.find("h1");
  if (headings.length !== 1) return refuse("source_subject_heading_ambiguous");
  const label = clean(headings.text());
  if (!label || label.length > 300) return refuse("source_subject_label_invalid");
  if (/this content is locked|access denied|verify you are human|just a moment/i.test(main.text())) return refuse("source_content_locked_or_challenged");
  const kind = url.includes("/collection/") ? "collection" : "vehicle_detail";
  const canonical = $("link[rel=canonical]").attr("href");
  if (canonical && ecrUrl(canonical) !== url) return refuse("source_canonical_url_conflict");
  if (kind === "vehicle_detail") {
    // Similar Cars are other subjects. Hidden fields never become VIN/year/owner claims.
    if (!main.find(".page_title").length || !/Car Timeline/.test(main.text())) return refuse("source_detail_structure_unavailable");
    return { ok: true as const, page: { kind, label, cards: [], current_total: null, previous_total: null,
      enumeration: "detail_only", hidden_fields: main.text().includes("Log in") } };
  }
  const current = main.find('.car_timeline [data-box="cars_1"]');
  const previous = main.find('.car_timeline [data-box="cars_4"]');
  if (current.length !== 1 || previous.length > 1) return refuse("source_collection_structure_unavailable");
  const cards: Array<{ url: string; label: string; relationship: string; image_url: string | null }> = [];
  for (const [region, relationship] of [[current, "source_current"], [previous, "source_previous"]] as const) {
    for (const el of region.find(".car_item > a.content[href]").toArray()) {
      const a = $(el), href = a.attr("href")!;
      let absolute: string;
      try { absolute = new URL(href, url).href; } catch { return refuse("source_card_url_invalid"); }
      const carUrl = ecrUrl(absolute);
      const title = clean(a.find(".title").text());
      if (!carUrl?.includes("/details/") || !title || title.length > 300) return refuse("source_card_identity_invalid");
      const image = a.find("img.image").attr("src");
      let imageUrl: string | null = null;
      if (image) {
        let candidate: URL;
        try { candidate = new URL(image, url); } catch { return refuse("source_image_url_invalid"); }
        if (candidate.origin === "https://exclusivecarregistry.com" && candidate.pathname.startsWith("/images/cars/")
          && !candidate.username && !candidate.password) imageUrl = candidate.href;
      }
      const existing = cards.find(c => c.url === carUrl && c.relationship === relationship);
      if (existing && (existing.label !== title || existing.image_url !== imageUrl)) return refuse("source_card_conflict");
      if (!existing) cards.push({ url: carUrl, label: title, relationship, image_url: imageUrl });
      if (cards.length > 500) return refuse("source_card_limit_exceeded");
    }
  }
  const total = (selector: string, word: string): number | null => {
    const text = clean(main.find(selector).text());
    const match = new RegExp(`^${word} \\(([0-9,]+)\\)$`).exec(text);
    const n = match ? Number(match[1].replaceAll(",", "")) : NaN;
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const currentTotal = total('.car_timeline .selection > [data-info="cars_1"]', "Current");
  const previousTotal = total('.car_timeline .selection > [data-info="cars_4"]', "Previous");
  for (const [relationship, n] of [["source_current", currentTotal], ["source_previous", previousTotal]] as const) {
    if (n !== null && cards.filter(c => c.relationship === relationship).length > n) return refuse("source_card_count_conflict");
  }
  return { ok: true as const, page: { kind, label, cards, current_total: currentTotal, previous_total: previousTotal,
    // Even a matching count doesn't prove an exhaustive registry or current ownership.
    enumeration: "captured_cards_only", hidden_fields: main.text().includes("Log in") } };
}

export async function qualifyEcrCapture(snapshot: any, html: string, now = Date.now()) {
  if (!snapshot || !UUID.test(snapshot.id) || snapshot.platform !== "ecr" || snapshot.success !== true || snapshot.http_status !== 200
    || !ecrUrl(snapshot.listing_url) || !/^[a-f0-9]{64}$/.test(snapshot.html_sha256 ?? "")) return refuse("source_capture_ineligible");
  const captured = observationClockMicroseconds(snapshot.fetched_at), recorded = observationClockMicroseconds(snapshot.created_at);
  if (captured === null || recorded === null || captured > recorded || !Number.isFinite(now) || captured > BigInt(Math.trunc(now)) * 1000n
    || recorded > BigInt(Math.trunc(now)) * 1000n) return refuse("source_clock_invalid");
  const bytes = new TextEncoder().encode(html);
  if (!bytes.length || bytes.length > 2_097_152) return refuse("source_body_unavailable_or_oversize");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  if (hash !== snapshot.html_sha256) return refuse("source_hash_mismatch");
  const parsed = await parseEcr(html, snapshot.listing_url);
  if (!parsed.ok) return parsed;
  const receipt = { profile: ECR_MODE, snapshot_id: snapshot.id, source_url: snapshot.listing_url,
    source_sha256: hash, captured_at: snapshot.fetched_at, capture_recorded_at: snapshot.created_at,
    event_time_status: "unknown", ownership_status: "unverified", staging_permission_status: "unknown", ...parsed.page };
  return { ok: true as const, receipt, input: {
    source_slug: ECR_SOURCE, kind: "listing", observed_at: snapshot.fetched_at, source_url: snapshot.listing_url,
    source_identifier: `${ECR_MODE}:${snapshot.id}`,
    content_text: `ECR registry presentation: ${parsed.page.label}. Captured source claims only; ownership, physical identity and staging permission are not established.`,
    structured_data: { ecr_capture_receipt: receipt }, extraction_method: ECR_METHOD,
    subject: { type: parsed.page.kind === "collection" ? "organization" : "vehicle" },
    raw_source_ref: `listing_page_snapshots:${snapshot.id}`, defer_analysis: true,
  } };
}

// Consumer-only projection of the verified original, outside the immutable v1
// admission receipt. Similar Cars and placeholder images are not this subject.
// Fresh unauthenticated visual review on 2026-10-31 found these exact references
// serve ECR's LOG IN artwork. Exclude only observed URLs, never dimensions; do
// not try another gallery URL as an access fallback. The source link remains.
const unavailableDetailImages = new Set([
  "https://exclusivecarregistry.com/images/gallery/car/full/795824",
  "https://exclusivecarregistry.com/images/gallery/car/full/357917",
]);
async function detailImage(html: string): Promise<string | null> {
  const { load } = await import("npm:cheerio@1.2.0");
  const $ = load(html);
  const galleries = $("main#details > .banner_gallery");
  if (galleries.length !== 1) return null;
  for (const element of galleries.find(".thumb > img").toArray()) {
    const src = $(element).attr("src");
    if (!src) continue;
    try {
      const u = new URL(src, "https://exclusivecarregistry.com");
      if (u.origin === "https://exclusivecarregistry.com" && !u.username && !u.password && !u.search && !u.hash
        && /^\/images\/gallery\/car\/(full|thumb)\/[1-9][0-9]*$/.test(u.pathname))
        return unavailableDetailImages.has(u.href) ? null : u.href;
    } catch { /* A missing or invalid presentation image does not invent one. */ }
  }
  return null;
}

export async function readEcrCapture(db: any, snapshotId: string, includePresentation = false) {
  const result = await db.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,created_at,success,http_status,html_sha256,html,html_storage_path")
    .eq("id", snapshotId).maybeSingle();
  if (result.error || !result.data) return refuse("source_capture_unavailable");
  const s = result.data;
  if (s.id !== snapshotId) return refuse("source_selector_binding_conflict");
  let html = s.html;
  if (typeof html !== "string") {
    const path = s.html_storage_path;
    if (typeof path !== "string" || !path.startsWith("ecr/") || /[:\\\x00-\x1f]/.test(path)
      || path.split("/").some((p: string) => !p || p === "." || p === "..")) return refuse("source_storage_locator_invalid");
    const stored = await db.storage.from("listing-snapshots").download(path);
    if (stored.error || !stored.data || stored.data.size > 2_097_152) return refuse("source_body_unavailable_or_oversize");
    try { html = new TextDecoder("utf-8", { fatal: true }).decode(await stored.data.arrayBuffer()); }
    catch { return refuse("source_encoding_invalid"); }
  }
  const checked = await qualifyEcrCapture(s, html);
  if (!checked.ok) return checked;
  return { ...checked, presentation_image_url: includePresentation && checked.receipt.kind === "vehicle_detail"
    ? await detailImage(html) : null };
}
