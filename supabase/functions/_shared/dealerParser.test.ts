import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dealerListing, parseDealerListing } from "./dealerParser.ts";
export const url = "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150";
export const document = (options: { stock?: string; availability?: string; currency?: string; year?: string; host?: string } = {}) => `<div itemscope itemtype="https://schema.org/Car">
<meta itemprop="productionDate" content="${options.year ?? "1995"}"><meta itemprop="manufacturer" content="Ford"><meta itemprop="model" content="F150">
<meta itemprop="sku" content="${options.stock ?? "42-DET"}"><meta itemprop="price" content="12345"><meta itemprop="priceCurrency" content="${options.currency ?? "USD"}">
<meta itemprop="availability" content="http://schema.org/${options.availability ?? "InStock"}"><link itemprop="url" href="${options.host ?? url}">
<meta itemprop="image" content="https://cdn.dealeraccelerate.com/synthetic/1/2/image"><div itemprop="description">Synthetic seller assertions.</div>
<dl><dt>Engine Size</dt><dd>V8</dd><dt>Transmission</dt><dd>Manual</dd></dl></div>`;
Deno.test("native dealer assertions retain stock/URL/asking currency and unknown physical configuration", () => {
  const p = parseDealerListing(document(), url);
  assertEquals([p.year, p.make, p.model, p.stock_id, p.price, p.engine], [1995, "Ford", "F150", "42-det", 12345, "V8"]);
  assertEquals(p.vin, null); assertEquals(p.availability, "in_stock");
  assertEquals(parseDealerListing(document({ currency: "CAD" }), url).price, null);
});
Deno.test("stock, offer URL, source host, ambiguous identity and withdrawals refuse", () => {
  for (const options of [{ stock: "43-DET" }, { availability: "OutOfStock" }, { host: url + "-other" }, { year: "unknown" }]) assertThrows(() => parseDealerListing(document(options), url));
  assertThrows(() => parseDealerListing(document() + document(), url));
  assertThrows(() => parseDealerListing(`<template>${document()}</template>`, url));
  for (const u of [url.replace(".com/", ".com.evil/"), url.replace("https:", "http:"), url + "?other=1"]) assertEquals(dealerListing(u), null);
});
Deno.test("GR price text without a declared currency stays a qualified source string", () => {
  const u = "https://www.grautogallery.com/vehicles/b1234-j/1995-ford-f150";
  const h = `<div itemscope itemtype="https://schema.org/Car"><meta itemprop="productionDate" content="1995"><meta itemprop="manufacturer" content="Ford"><meta itemprop="model" content="F150"><dl><div><dt>Stock</dt><dd>B1234 J</dd></div><div><dt>Vin</dt><dd>SYNTHETICVIN000001</dd></div></dl><div class="ag-price">$12,345</div></div>`;
  const p = parseDealerListing(h, u); assertEquals(p.price, null); assertEquals(p.source_price_text, "$12,345"); assertEquals(p.availability, "unknown");
  assertThrows(() => parseDealerListing(h.replace("$12,345", "SOLD"), u));
});

Deno.test("Streetside dot-grouped metadata requires the same offer's explicit USD cash display", () => {
  const metadata = document().replace('content="12345"', 'content="16.995"');
  const offer = '<span itemprop="offers" itemscope itemtype="http://schema.org/Offer"><div class="price">$16,995</div><div class="monthly">$146.10/month</div></span>';
  const h = metadata.replace('</dl></div>', '</dl>' + offer + '</div>');
  assertEquals(parseDealerListing(h, url).price, 16995);
  assertEquals(parseDealerListing(metadata, url).price, null);
  assertEquals(parseDealerListing(h.replace('$16,995', '$17,995'), url).price, null);
  assertEquals(parseDealerListing(h.replace('content="USD"', 'content="CAD"'), url).price, null);
  assertEquals(parseDealerListing(metadata.replace('</dl></div>', '</dl><div class="price">$16,995</div></div>'), url).price, null);
});
