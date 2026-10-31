import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gatewayListing, gatewayInventoryUrls, parseGatewayListing } from "./gatewayParser.ts";
const url = "https://www.gatewayclassiccars.com/vehicles/det/42/1995-ford-f150";
export const vehicle = () => ({ "@type": ["Product", "Vehicle"], name: "1995 Ford F150", url,
  sku: "42-DET", brand: { name: "Ford" }, model: "F150", vehicleModelDate: "1995", vehicleIdentificationNumber: "SYNTHETICVIN000001",
  description: "Synthetic dealer listing", offers: { url, price: 12345, priceCurrency: "USD", availability: "https://schema.org/InStock" },
  mileageFromOdometer: { value: 24000, unitCode: "SMI" }, image: ["https://cdn.dealeraccelerate.com/gatewayclassiccars/1/42/123/790x1024/synthetic"] });
export const document = (v: unknown) => `<html><script type='application/ld+json'>${JSON.stringify({ "@graph": [v] })}</script></html>`;

Deno.test("malformed publisher inventory JSON-LD still discovers active stock links", () => {
  const html = `<html><title>Full Inventory | Gateway Classic Cars</title>
    <script type="application/ld+json">{"@type":"ItemList","name":"unterminated</script>
    <a href="${url}">stock</a><a href="${url}">duplicate</a>
    <template><a href="https://www.gatewayclassiccars.com/vehicles/det/43/inert">inert</a></template></html>`;
  assertEquals(gatewayInventoryUrls(html), [url]);
  assertThrows(() => gatewayInventoryUrls(html.replace("Full Inventory | Gateway Classic Cars", "Access denied")));
});

Deno.test("Gateway native principal identity, asking amount, units and source URL stay associated", () => {
  const p = parseGatewayListing(document(vehicle()), url);
  assertEquals([p.year, p.make, p.model, p.stock_id, p.price, p.mileage], [1995, "Ford", "F150", "det:42", 12345, 24000]);
  assertEquals(p.source_offer.availability, "https://schema.org/InStock");
  assertEquals(gatewayListing(url.replace("www.", ""))?.url, url);
  for (const bad of [url.replace(".com/", ".com.evil/"), url.replace("https:", "http:"), url.replace("www.", "owner@www."), url + "?other=1"]) assertEquals(gatewayListing(bad), null);
});
Deno.test("an inventory/recommendation is not the principal vehicle; stock and URL conflicts refuse", () => {
  assertThrows(() => parseGatewayListing(document({ "@type": "ItemList", itemListElement: [{ item: vehicle() }] }), url));
  assertThrows(() => parseGatewayListing(document({ ...vehicle(), sku: "43-DET" }), url));
  assertThrows(() => parseGatewayListing(document({ ...vehicle(), url: url + "-other" }), url));
  assertThrows(() => parseGatewayListing(document(vehicle()) + document(vehicle()), url));
  assertThrows(() => parseGatewayListing("<!--" + document(vehicle()) + "-->", url));
  assertThrows(() => parseGatewayListing("<template>" + document(vehicle()) + "</template>", url));
});
Deno.test("unknown currency/unit and withdrawn availability never become a current USD sale", () => {
  const v = vehicle(); v.offers.priceCurrency = "CAD"; v.mileageFromOdometer.unitCode = "KMT";
  const p = parseGatewayListing(document(v), url); assertEquals(p.price, null); assertEquals(p.mileage, null);
  assertEquals(p.price_currency, "CAD");
  v.offers.availability = "https://schema.org/OutOfStock";
  assertThrows(() => parseGatewayListing(document(v), url), Error, "not_explicitly_in_stock");
});
Deno.test("Gateway inventory only enumerates published same-source listing URLs", () => {
  const h = document({ "@type": "ItemList", name: "Gateway Classic Cars Inventory", itemListElement: [
    { item: vehicle() }, { item: vehicle() }, { item: { url: "https://outside.invalid/vehicles/det/42/test" } },
  ] });
  assertEquals(gatewayInventoryUrls(h), [url]);
  assertThrows(() => gatewayInventoryUrls(document(vehicle())));
});
