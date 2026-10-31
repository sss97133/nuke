import { parse } from "https://esm.sh/parse5@7.3.0";

export const DEALER_PARSER = "dealer_microdata_v1";
export const DEALERS = {
  gr_auto_gallery: { host: "www.grautogallery.com", slug: "gr-auto-gallery", event: "GR Auto Gallery", stock: /^[a-z]{1,3}\d{3,5}(?:-[a-z0-9]+)?$/ },
  streetside_classics: { host: "www.streetsideclassics.com", slug: "streetside-classics", event: "Streetside Classics", stock: /^\d+-[a-z]{2,4}$/ },
} as const;
export type DealerPlatform = keyof typeof DEALERS;
export function dealerHost(url: string): DealerPlatform | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (Object.keys(DEALERS) as DealerPlatform[]).find(k => host === DEALERS[k].host.replace(/^www\./, "")) ?? null;
  } catch { return null; }
}
export function dealerListing(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
    const platform = dealerHost(url);
    const m = u.pathname.match(/^\/vehicles\/([^/]+)\/([a-z0-9-]+)\/?$/);
    if (!platform || !m || !DEALERS[platform].stock.test(m[1])) return null;
    return { platform, stock_id: m[1], url: `https://${DEALERS[platform].host}/vehicles/${m[1]}/${m[2]}` };
  } catch { return null; }
}
const attr = (n: any, k: string): string | undefined => n.attrs?.find((a: any) => a.name === k)?.value;
const inert = (n: any) => ["script", "style", "template", "svg", "noscript"].includes(n.tagName);
const text = (n: any): string => inert(n) ? "" : String(n.value ?? (n.childNodes ?? []).map(text).join(" ")).replace(/\s+/g, " ").trim();
const unique = (values: string[] = []) => [...new Set(values.map(v => v.trim()).filter(Boolean))];
const one = (values: string[] = []): string | null => unique(values).length === 1 ? unique(values)[0] : null;
const stockKey = (v: string) => v.replace(/[^a-z0-9]/gi, "").toLowerCase();

/** Native publisher assertions, not factory facts or physical-vehicle verification. */
export function parseDealerListing(html: string, sourceUrl: string) {
  const listing = dealerListing(sourceUrl);
  if (!listing || new TextEncoder().encode(html).byteLength > 2_097_152) throw Error("dealer_document_invalid");
  const doc = parse(html), cars: any[] = [];
  const find = (n: any) => {
    if (inert(n)) return;
    if (attr(n, "itemscope") !== undefined && /^https?:\/\/schema\.org\/Car$/.test(attr(n, "itemtype") ?? "")) cars.push(n);
    for (const c of n.childNodes ?? []) find(c);
  };
  find(doc);
  if (cars.length !== 1) throw Error("dealer_principal_not_established");
  const props: Record<string, string[]> = {}, labels: Record<string, string[]> = {}; let priceText: string | null = null;
  const walk = (n: any) => {
    if (inert(n)) return;
    const prop = attr(n, "itemprop");
    if (prop) (props[prop] ??= []).push(attr(n, "content") ?? attr(n, "href") ?? attr(n, "src") ?? text(n));
    if ((attr(n, "class") ?? "").split(/\s+/).includes("ag-price")) priceText = text(n);
    if (["dt", "th"].includes(n.tagName)) {
      const siblings = n.parentNode?.childNodes ?? [], index = siblings.indexOf(n);
      const value = siblings.slice(index + 1).find((v: any) => ["dd", "td", "dt", "th"].includes(v.tagName));
      if (["dd", "td"].includes(value?.tagName)) (labels[text(n).toLowerCase().replace(/[^a-z]/g, "")] ??= []).push(text(value));
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(cars[0]);
  const year = Number(one(props.productionDate)), make = one(props.manufacturer), model = one(props.model);
  const stocks = unique([...(props.sku ?? []), ...(labels.stock ?? [])]);
  if (!stocks.length || stocks.some(s => stockKey(s) !== stockKey(listing.stock_id))) throw Error("dealer_stock_identity_conflict");
  if (!Number.isInteger(year) || year < 1886 || year > new Date().getUTCFullYear() + 2 || !make || !model) throw Error("dealer_identity_incomplete");
  const sourceAvailability = unique(props.availability);
  if (listing.platform === "streetside_classics" && (sourceAvailability.length !== 1 || !/^https?:\/\/schema\.org\/InStock$/.test(sourceAvailability[0]))) throw Error("dealer_not_explicitly_in_stock");
  if (listing.platform === "gr_auto_gallery" && (!priceText || /\bsold\b|\bpending\b/i.test(priceText))) throw Error("dealer_live_offer_not_established");
  const sourcePrice = one(props.price), currency = one(props.priceCurrency);
  const price = currency === "USD" && sourcePrice && /^\d+(?:\.\d{1,2})?$/.test(sourcePrice) && Number.isFinite(Number(sourcePrice)) && Number(sourcePrice) > 0 ? Number(sourcePrice) : null;
  const urls = unique(props.url);
  if (urls.some(u => dealerListing(u)?.url !== listing.url)) throw Error("dealer_offer_identity_conflict");
  const images = unique(props.image).filter(u => { try { const v = new URL(u); return v.protocol === "https:" && v.hostname === "cdn.dealeraccelerate.com"; } catch { return false; } });
  return { ...listing, year, make, model, vin: one(labels.vin), description: one(props.description),
    price, price_currency: currency, source_price_text: priceText, source_price: sourcePrice,
    source_availability: sourceAvailability, availability: listing.platform === "streetside_classics" ? "in_stock" : "unknown",
    engine: one(labels.enginesize ?? labels.engine), transmission: one(labels.transmissiontype ?? labels.transmission),
    image_url: images[0] ?? null, image_urls: images, source_attributes: labels };
}
