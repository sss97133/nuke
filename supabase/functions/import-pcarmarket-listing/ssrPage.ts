// PCarMarket's current pages are server-rendered: the stats band, the "Car Details" and "Auction Details" <dl>
// blocks and the gallery are in the HTML, so a plain fetch carries every field (measured 2026-10-15).
// Pure, no I/O. Returns null for a page that is not an auction page (no Car Details block, e.g. a watch or sign).

export interface SsrListing {
  title: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  transmission?: string;
  color?: string;
  interiorColor?: string;
  location?: string;
  auctionType?: string;
  sellerType?: string;
  auctionEndDate?: string;
  salePrice?: number; // sold price when outcome is sold, otherwise the final high bid
  auctionOutcome: "sold" | "reserve_not_met" | "ended_unknown";
  bidCount?: number;
  viewCount?: number;
  description?: string;
  images: string[];
  canonicalUrl?: string;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const num = (s?: string) => {
  const n = Number((s ?? "").replace(/[^0-9.]/g, ""));
  return s && Number.isFinite(n) && n > 0 ? n : undefined;
};

export function parseSsrPage(html: string): SsrListing | null {
  if (!html.includes("Car Details")) return null;
  const dl = new Map<string, string>();
  for (const m of html.matchAll(/<dt[^>]*>([^<]+)<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/g)) {
    const k = text(m[1]);
    if (k && !dl.has(k)) dl.set(k, text(m[2]));
  }
  const year = num(dl.get("Year"));
  const make = dl.get("Make");
  const model = dl.get("Model");
  if (!year || !make || !model) return null;

  // Stats band: <span ...>Sold|Final bid</span></span><p ...>$127,000</p>
  const band = new Map<string, string>();
  for (const m of html.matchAll(/<span class="flex h-6 items-center"><span[^>]*>([^<]+)<\/span><\/span><p[^>]*>([\s\S]*?)<\/p>/g)) {
    const k = text(m[1]);
    if (k && !band.has(k)) band.set(k, text(m[2]));
  }
  const stat = (label: string) => {
    const m = html.match(new RegExp(`>${label}</p><p[^>]*>(?:<svg[\\s\\S]*?</svg>)?\\s*([0-9,]+)</p>`));
    return m ? num(m[1]) : undefined;
  };

  const soldPrice = num(band.get("Sold"));
  const finalBid = num(band.get("Final bid"));
  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s*[—|-]\s*(Sold|Auction Ended)?\s*\|?\s*PCARMARKET\s*$/i, "")).trim();
  const ended = dl.get("Ended");
  const endedDate = ended ? new Date(`${ended} UTC`) : null;

  const images: string[] = [];
  for (const m of html.matchAll(/<img[^>]+src="(https:\/\/assets\.basta\.app\/[^"]+)"/g)) {
    const u = decode(m[1]).replace(/\?.*$/, "");
    if (!images.includes(u)) images.push(u);
  }

  const para = [...html.matchAll(/<div class="prose[^>]*>([\s\S]*?)<\/div>/g)][0]?.[1];
  const mileage = num((dl.get("Mileage Shown") ?? "").replace(/mi.*/i, ""));

  return {
    title,
    year,
    make,
    model,
    vin: dl.get("VIN") || undefined,
    mileage,
    transmission: dl.get("Transmission"),
    color: dl.get("Exterior Color"),
    interiorColor: dl.get("Interior"),
    location: dl.get("Location"),
    auctionType: dl.get("Auction Type"),
    sellerType: dl.get("Seller Type"),
    auctionEndDate: endedDate && !Number.isNaN(endedDate.getTime()) ? endedDate.toISOString() : undefined,
    salePrice: soldPrice ?? finalBid,
    auctionOutcome: soldPrice ? "sold" : finalBid ? "reserve_not_met" : "ended_unknown",
    bidCount: stat("Bids"),
    viewCount: num(html.match(/([0-9,]+) views/)?.[1]),
    description: para ? text(para.replace(/<\/p>/g, "\n")).slice(0, 8000) : undefined,
    images,
    canonicalUrl: html.match(/property="og:url" content="([^"]+)"/)?.[1],
  };
}
