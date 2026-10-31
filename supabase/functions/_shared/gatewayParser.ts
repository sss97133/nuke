import { parse } from "https://esm.sh/parse5@7.3.0";

export const GATEWAY_PARSER = "gateway_jsonld_v1";
export function gatewayListing(url: string): { url: string; id: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !["gatewayclassiccars.com", "www.gatewayclassiccars.com"].includes(u.hostname)
      || u.username || u.password || u.port || u.search || u.hash) return null;
    const m = u.pathname.match(/^\/vehicles\/([a-z]{2,4})\/(\d+)\/([a-z0-9-]+)\/?$/);
    return m ? { url: `https://www.gatewayclassiccars.com/vehicles/${m[1]}/${m[2]}/${m[3]}`, id: `${m[1]}:${m[2]}` } : null;
  } catch { return null; }
}

function jsonLd(html: string): any[] {
  if (new TextEncoder().encode(html).byteLength > 2_097_152) throw Error("gateway_body_too_large");
  const rows: any[] = [];
  const walk = (node: any) => {
    if (["template", "svg", "noscript"].includes(node.tagName)) return;
    if (node.tagName === "script" && node.attrs?.some((a: any) => a.name === "type" && a.value.toLowerCase() === "application/ld+json")) {
      try {
        const value = JSON.parse((node.childNodes ?? []).map((n: any) => n.value ?? "").join(""));
        for (const root of Array.isArray(value) ? value : [value]) rows.push(...(Array.isArray(root?.["@graph"]) ? root["@graph"] : [root]));
      } catch { /* Some publisher blocks are malformed. A principal must still be established independently. */ }
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(parse(html));
  return rows;
}
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

export function gatewayInventoryUrls(html: string): string[] {
  const lists = jsonLd(html).filter(v => v?.["@type"] === "ItemList" && v.name === "Gateway Classic Cars Inventory");
  if (lists.length > 1) throw Error("gateway_inventory_ambiguous");
  if (lists.length === 1 && Array.isArray(lists[0].itemListElement)) {
    return [...new Set<string>(lists[0].itemListElement.map((v: any) => gatewayListing(v?.item?.url ?? "")?.url).filter(Boolean))];
  }
  // A broken inventory JSON-LD block must not hide actual published links.
  // These are discovery only; each detail must independently prove its native identity and offer.
  const doc: any = parse(html), urls = new Set<string>(); let inventoryTitle = false;
  const walk = (node: any) => {
    if (["template", "script", "svg", "noscript"].includes(node.tagName)) return;
    if (node.tagName === "title") inventoryTitle = (node.childNodes ?? []).some((n: any) => /Full Inventory.*Gateway Classic Cars/.test(n.value ?? ""));
    if (node.tagName === "a") {
      const href = node.attrs?.find((a: any) => a.name === "href")?.value;
      if (href) { try { const listing = gatewayListing(new URL(href, "https://www.gatewayclassiccars.com").href); if (listing) urls.add(listing.url); } catch { /* malformed link */ } }
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  walk(doc);
  if (!inventoryTitle || !urls.size) throw Error("gateway_inventory_not_established");
  return [...urls];
}

export function parseGatewayListing(html: string, sourceUrl: string) {
  const listing = gatewayListing(sourceUrl);
  if (!listing) throw Error("gateway_listing_url_invalid");
  const vehicles = jsonLd(html).filter(v => (Array.isArray(v?.["@type"]) ? v["@type"] : [v?.["@type"]]).includes("Vehicle")
    && gatewayListing(v.url ?? "")?.url === listing.url);
  if (vehicles.length !== 1) throw Error("gateway_vehicle_not_established");
  const v = vehicles[0], offer = v.offers;
  const [city, stock] = listing.id.split(":");
  if (v.sku?.toUpperCase() !== `${stock}-${city.toUpperCase()}` || gatewayListing(offer?.url ?? "")?.url !== listing.url) throw Error("gateway_stock_identity_conflict");
  const year = Number(v.vehicleModelDate), make = text(v.brand?.name), model = text(v.model);
  if (!Number.isInteger(year) || year < 1886 || year > new Date().getUTCFullYear() + 2 || !make || !model) throw Error("gateway_identity_incomplete");
  // This adapter collects the source's explicitly live inventory. An asking offer is never a sale.
  if (offer.availability !== "https://schema.org/InStock") throw Error("gateway_not_explicitly_in_stock");
  const amount = typeof offer.price === "number" ? offer.price : /^\d+(?:\.\d{1,2})?$/.test(offer.price ?? "") ? Number(offer.price) : null;
  const price = offer.priceCurrency === "USD" && Number.isFinite(amount) && amount > 0 ? amount : null;
  const images: unknown[] = Array.isArray(v.image) ? v.image : [v.image];
  const image_urls = images.filter((u: unknown): u is string => {
    try { const image = new URL(String(u)); return image.protocol === "https:" && image.hostname === "cdn.dealeraccelerate.com" && /^\/gatewayclassiccars\/\d+\/\d+\//.test(image.pathname); } catch { return false; }
  });
  return { url: listing.url, stock_id: listing.id, year, make, model, vin: text(v.vehicleIdentificationNumber),
    description: text(v.description), price, price_currency: offer.priceCurrency ?? null,
    mileage: v.mileageFromOdometer?.unitCode === "SMI" && Number.isFinite(v.mileageFromOdometer.value) && v.mileageFromOdometer.value >= 0 ? v.mileageFromOdometer.value : null,
    engine: text(v.vehicleEngine?.name), transmission: text(v.vehicleTransmission),
    image_url: image_urls[0] ?? null, image_urls: [...new Set(image_urls)], source_offer: offer,
    source_mileage: v.mileageFromOdometer ?? null, availability: "in_stock" as const };
}
