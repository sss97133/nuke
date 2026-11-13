import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { batListingClassification, listingKindUpdate } from "./listingKind.ts";
const group = (path: string, label: string, value: string) => `<a class="group-link" href="https://bringatrailer.com/${path}/"><strong class="group-title-label">${label}</strong>${value}</a>`;
const url = "https://bringatrailer.com/listing/2019-porsche-911-gt2-rs-clubsport-25/";
const bundled = group("parts", "Category", "Parts") + group("race-car", "Category", "Race Cars");
Deno.test("Porsche plus enclosed trailer: both publisher categories survive and vehicle category wins", () => {
  assertEquals(batListingClassification(bundled), { kind: "vehicle", categories: ["Parts", "Race Cars"], basis: "bat_category_links_v1" });
  assertEquals(batListingClassification(group("race-car", "Category", "Race Cars") + group("parts", "Category", "Parts")).kind, "vehicle");
});
Deno.test("parts alone stay excluded even with Porsche make and a vehicle name in title", () => {
  assertEquals(batListingClassification('<h1>2019 Porsche GT2 RS Wheels</h1>' + group("porsche", "Make", "Porsche") + group("parts", "Category", "Parts")).kind, "non_vehicle_item");
});
Deno.test("missing or unfamiliar taxonomy never clears a prior exclusion", () => {
  assertEquals(listingKindUpdate(batListingClassification(""), url, url), {});
  assertEquals(listingKindUpdate(batListingClassification(group("special", "Category", "Special")), url, url), {});
});
Deno.test("exact lot re-extraction corrects old exclusion without reclassifying another presentation", () => {
  assertEquals(listingKindUpdate(batListingClassification(bundled), url.slice(0,-1), url), { listing_kind: "vehicle" });
  assertEquals(listingKindUpdate(batListingClassification(bundled), "https://bringatrailer.com/listing/another-lot/", url), {});
  assertEquals(listingKindUpdate(batListingClassification(bundled), "https://www.pcarmarket.com/auction/another-lot/", url), {});
});

Deno.test("category markup variants preserve Parts and discover a second vehicle category", () => {
  const parts = `<a data-id="379" href="https://bringatrailer.com/parts/" class="group-link"><strong data-label="category" class='extra group-title-label'> Category </strong> Parts</a>`;
  const race = `<a href="https://bringatrailer.com/race-car/"><strong class="group-title-label extra">Category</strong> Race Cars</a>`;
  assertEquals(batListingClassification(parts).kind, "non_vehicle_item");
  assertEquals(batListingClassification(parts + race).kind, "vehicle");
  assertEquals(listingKindUpdate(batListingClassification(bundled), null, url), {});
  assertEquals(listingKindUpdate(batListingClassification(bundled), "", url), {});
});
