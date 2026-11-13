import { readBatTaxonomy } from "../_shared/batParser.ts";
import { normalizeListingUrlKey } from "../_shared/listingUrl.ts";

// Categories are overlapping publisher testimony: a car bundled with a trailer
// can be both Parts and Race Cars. The first category is not a primary-subject flag.
export function batListingClassification(html: string) {
  // Preserve the older essentials parser's tolerance for attribute/spacing variants.
  // Read every Category label so an unrecognized anchor shape cannot turn Parts
  // into the default vehicle classification or discard a second vehicle category.
  const labels = [...html.matchAll(/<strong[^>]*class=["'][^"']*group-title-label[^"']*["'][^>]*>\s*Category\s*<\/strong>\s*([^<]+)/gi)]
    .map(match => match[1].replace(/&amp;/g, "&").trim()).filter(Boolean);
  const categories = [...new Set([...readBatTaxonomy(html).categories, ...labels])];
  const names = categories.map(value => value.toLowerCase());
  const hasVehicleCategory = names.some(value => ["race cars", "truck & 4x4", "motorcycles"].includes(value));
  const kind = hasVehicleCategory ? "vehicle" : names.includes("parts") ? "non_vehicle_item" : null;
  return { kind, categories, basis: "bat_category_links_v1" } as const;
}

export function listingKindUpdate(
  classification: ReturnType<typeof batListingClassification>,
  existingUrl: string | null | undefined,
  sourceUrl: string,
): { listing_kind?: "vehicle" | "non_vehicle_item" } {
  // A past/different presentation cannot reclassify a shared canonical asset.
  if (!existingUrl || !normalizeListingUrlKey(existingUrl) ||
      normalizeListingUrlKey(existingUrl) !== normalizeListingUrlKey(sourceUrl)) return {};
  return classification.kind ? { listing_kind: classification.kind } : {};
}
