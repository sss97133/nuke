/**
 * Art and automobilia lots from the Bonhams search index, mapped to the `record_asset_lots` writer's input.
 * Pure: no network, no database. The index document is the house's presentation of a lot; every field below is
 * the house's claim, kept with its department as the house labels it. Nothing is parsed into artist, medium or
 * edition columns here (discovery-first: the catalogue lines are retained, the fields crystallise from use).
 */

/** Our asset type for a Bonhams department code, or null when the department is not in this slice. */
export function assetTypeForDepartment(code: string | null | undefined): "artwork" | "automobilia" | null {
  const c = (code ?? "").toUpperCase();
  if (!c) return null;
  if (c.startsWith("PIC-") || c === "PHO" || c === "WOA") return "artwork";
  if (c === "MOT-AUT" || c === "COL-AUT") return "automobilia";
  return null;
}

/** The department codes this slice walks, in the order a run takes them when none is named. */
export const ART_DEPARTMENTS = [
  "PIC-GEN", "PIC-PRT", "PIC-CON", "PIC-IMP", "PIC-MBT", "PIC-VOP", "PIC-OMP", "PIC-EUR", "PIC-CAL", "PIC-WAT",
  "PIC-MCA", "PIC-CHI", "PIC-FRA", "PIC-AUS", "PIC-AMP", "PIC-TOP", "PIC-SCO", "PIC-RUS", "PIC-MIC", "PHO", "WOA",
  "MOT-AUT", "COL-AUT",
] as const;

export interface ArtIndexDoc {
  id: string;
  auctionId?: string;
  lotId?: string;
  lotUniqueId?: string;
  lotNo?: { full?: string };
  title?: string;
  slug?: string;
  catalogDesc?: string;
  styledDescription?: string;
  footnotes?: string;
  department?: { code?: string; name?: string };
  currency?: { iso_code?: string };
  country?: { name?: string; code?: string };
  price?: { estimateLow?: number; estimateHigh?: number; hammerPrice?: number; hammerPremium?: number };
  flags?: { isAuctionEnded?: boolean; isResultPublished?: boolean; isWithoutReserve?: boolean };
  hammerTime?: { datetime?: string };
  auctionEndDate?: { datetime?: string };
  image?: { url?: string } | string;
  symbols?: Array<{ symbol?: string; shortDescription?: string }>;
  groups?: unknown[];
}

export interface ArtLotRecord {
  identity_key: string;
  asset_type: "artwork" | "automobilia";
  title: string;
  source_identifier: string;
  source_url: string;
  observed_at: string;
  observed_at_basis: "hammer_time" | "index_read";
  department_code: string;
  department_name: string | null;
  lot_number: string | null;
  sale_key: string | null;
  sale_ends_at: string | null;
  result: "sold" | "not_sold" | "upcoming";
  price_basis: "hammer" | null;
  hammer_price: number | null;
  hammer_premium: number | null;
  estimate_low: number | null;
  estimate_high: number | null;
  currency: string | null;
  lines: string[];
  catalog_text: string | null;
  footnotes: string | null;
  image_url: string | null;
  symbols: string[];
  country: string | null;
  extraction_method: string;
  ts_page: number;
  ts_pass: number;
}

export const ART_LOT_METHOD = "bonhams_index_art_v1";

function stripHtml(html: string): string {
  let text = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/div>/gi, "\n");
  // Remove tags until none remain, so a tag split by another tag is not left behind.
  let before: string;
  do {
    before = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== before);
  // Entities in one pass: a decoded result is never decoded again.
  text = text.replace(/&(#(\d{1,6})|amp|lt|gt|quot|apos|nbsp);/gi, (_m, name: string, num?: string) => {
    if (num) { const n = Number(num); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
    switch (name.toLowerCase()) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: return " ";
    }
  });
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The index wraps some strings in literal quotes ("\"Lucio Fontana ...\""); the house's text is inside them. */
function unquote(s: string | undefined | null): string {
  const t = (s ?? "").trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/\\"/g, '"') : t;
}

/** The styled description's lines: the house's own layout (artist line, dates line, title line, ...). */
export function catalogueLines(doc: ArtIndexDoc): string[] {
  const styled = unquote(doc.styledDescription);
  if (!styled) return [];
  return stripHtml(styled).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
}

function imageUrl(doc: ArtIndexDoc): string | null {
  const img = doc.image;
  if (!img) return null;
  if (typeof img === "string") {
    try {
      const parsed = JSON.parse(img) as { url?: string };
      return typeof parsed?.url === "string" && parsed.url.startsWith("http") ? parsed.url : null;
    } catch { return null; }
  }
  return typeof img.url === "string" && img.url.startsWith("http") ? img.url : null;
}

function isoOrNull(s: string | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function positive(n: number | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/**
 * One index document to one writer record, or null when the lot is outside the slice (department not art or automobilia,
 * no title, no id). `readAt` is the index read clock; the observation clock is the hammer time once the sale has ended.
 */
export function artLotFromDoc(doc: ArtIndexDoc, ctx: { readAt: string; page: number; pass: number }): ArtLotRecord | null {
  const code = (doc.department?.code ?? "").toUpperCase();
  const assetType = assetTypeForDepartment(code);
  const title = unquote(doc.title);
  const id = String(doc.id ?? "").trim();
  if (!assetType || !title || title.length < 3 || !/^[0-9]+(-[0-9]+)?$/.test(id)) return null;

  const ended = doc.flags?.isAuctionEnded === true;
  const hammer = positive(doc.price?.hammerPrice);
  const premium = positive(doc.price?.hammerPremium);
  const hammerAt = isoOrNull(doc.hammerTime?.datetime);
  const saleEnds = isoOrNull(doc.auctionEndDate?.datetime);
  const result: ArtLotRecord["result"] = ended ? (hammer ? "sold" : "not_sold") : "upcoming";
  const observedAt = ended && hammerAt ? hammerAt : ctx.readAt;

  const slug = unquote(doc.slug);
  const lotPath = doc.lotId && doc.lotId !== "0" ? doc.lotId : id;
  return {
    identity_key: `bonhams:${id}`,
    asset_type: assetType,
    title: title.slice(0, 500),
    source_identifier: id,
    source_url: `https://www.bonhams.com/auction/${doc.auctionId ?? ""}/lot/${lotPath}/${slug}`.replace(/\/+$/, ""),
    observed_at: observedAt,
    observed_at_basis: ended && hammerAt ? "hammer_time" : "index_read",
    department_code: code,
    department_name: doc.department?.name ?? null,
    lot_number: doc.lotNo?.full && doc.lotNo.full !== "0" ? doc.lotNo.full : null,
    sale_key: doc.auctionId ? `bonhams-${doc.auctionId}` : null,
    sale_ends_at: saleEnds,
    result,
    price_basis: hammer ? "hammer" : null,
    hammer_price: hammer,
    hammer_premium: premium,
    estimate_low: positive(doc.price?.estimateLow),
    estimate_high: positive(doc.price?.estimateHigh),
    currency: doc.currency?.iso_code ?? null,
    lines: catalogueLines(doc),
    catalog_text: doc.catalogDesc ? stripHtml(unquote(doc.catalogDesc)).slice(0, 8000) || null : null,
    footnotes: doc.footnotes ? stripHtml(unquote(doc.footnotes)).slice(0, 4000) || null : null,
    image_url: imageUrl(doc),
    symbols: (doc.symbols ?? []).map((s) => s.symbol ?? s.shortDescription ?? "").filter(Boolean).slice(0, 10),
    country: doc.country?.name ?? null,
    extraction_method: ART_LOT_METHOD,
    ts_page: ctx.page,
    ts_pass: ctx.pass,
  };
}

/** The Typesense filter for one department's published lots (results published covers sold, not sold and upcoming lots the house shows). */
export function artDepartmentFilter(code: string): string {
  return `department.code:=${code} && flags.isResultPublished:true`;
}
