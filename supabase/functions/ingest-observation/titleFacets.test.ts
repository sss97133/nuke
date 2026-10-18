import { deriveTitleFacet, titleFacetSelector, titleFacetWitness, TITLE_FACET_MODE } from "./titleFacets.ts";
import { validateObservationProperty, type ObservationPropertyRegistryRow } from "./imageProperties.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const id = (year: number, make: string, model: string) => ({ year, make, model });

Deno.test("a trim or body label is kept only when the title itself carries it", () => {
  assertEquals(titleFacetWitness("trim", "1984 Chevrolet C10 Silverado Pickup", id(1984, "Chevrolet", "C10")), "Silverado", "Silverado");
  assertEquals(titleFacetWitness("trim", "1975 Chevrolet C10 Scottsdale Pickup", id(1975, "Chevrolet", "C10")), "Scottsdale", "Scottsdale");
  assertEquals(titleFacetWitness("trim", "1981 Chevrolet C10 Custom Deluxe", id(1981, "Chevrolet", "C10")), "Custom Deluxe", "Custom Deluxe");
  assertEquals(titleFacetWitness("body_style", "1974 Chevrolet C10 Shortbed Stepside", id(1974, "Chevrolet", "C10")), "Stepside", "Stepside");
  assertEquals(titleFacetWitness("body_style", "1963 Chevrolet Corvette Split Window Coupe", id(1963, "Chevrolet", "Corvette")),
    "Split-Window Coupe", "hyphen and spacing fold");
  assertEquals(titleFacetWitness("body_style", "1965 Ford Mustang Fastback", id(1965, "Ford", "Mustang")), "Fastback", "Fastback");
  assertEquals(titleFacetWitness("trim", "1984 Chevrolet C10 Pickup", id(1984, "Chevrolet", "C10")), null, "no trim word, no trim");
});

Deno.test("a value the parser infers rather than reads is refused", () => {
  assertEquals(titleFacetWitness("body_style", "1965 Porsche 911", id(1965, "Porsche", "911")), null, "911 is not stated as a coupe");
  assertEquals(titleFacetWitness("body_style", "1970 Ford Mustang Mach 1", id(1970, "Ford", "Mustang")), null, "Mach 1 does not state Fastback");
});

Deno.test("a copy, a part or a conversion yields no label", () => {
  assertEquals(titleFacetWitness("trim", "1966 Ford Mustang Shelby GT350-R Replica", id(1966, "Ford", "Mustang")), null, "replica");
  assertEquals(titleFacetWitness("trim", "1963 Chevrolet Corvette Grand Sport Replica", id(1963, "Chevrolet", "Corvette")), null, "replica");
  assertEquals(titleFacetWitness("body_style", "1965 Porsche 911 Engine", id(1965, "Porsche", "911")), null, "engine listing");
  assertEquals(titleFacetWitness("trim", "1985 Chevrolet C10 Silverado Tribute", id(1985, "Chevrolet", "C10")), null, "tribute");
});

Deno.test("the selector names one vehicle and one key, nothing else", () => {
  const vehicleId = "10000000-0000-4000-8000-000000000001";
  assertEquals(titleFacetSelector({ mode: TITLE_FACET_MODE, vehicle_id: vehicleId, property_key: "trim" }),
    { vehicleId, key: "trim" }, "valid selector");
  assertEquals(titleFacetSelector({ mode: TITLE_FACET_MODE, vehicle_id: vehicleId, property_key: "trim", structured_data: { trim: "x" } }),
    null, "caller values are refused");
  assertEquals(titleFacetSelector({ mode: TITLE_FACET_MODE, vehicle_id: vehicleId, property_key: "series" }), null, "unsupported key");
});

const registry: ObservationPropertyRegistryRow = {
  id: "11111111-1111-4111-8111-111111111111", namespace: "core", deprecated_at: null, applies_to_kinds: ["specification"],
};
const vehicle = {
  id: "10000000-0000-4000-8000-000000000002", is_public: true, deleted_at: null, listing_kind: "vehicle",
  year: 1984, make: "Chevrolet", model: "C10", listing_title: "1984 Chevrolet C10 Silverado Pickup",
  listing_url: "https://bringatrailer.com/listing/1984-chevrolet-c10-silverado/", discovery_url: null,
};

Deno.test("a derived title claim is attributed, qualified and admitted only through the selector", () => {
  const derived = deriveTitleFacet(vehicle, "trim", "2026-10-18T02:00:00.000Z")!;
  assertEquals(derived.source_slug, "internal-inference", "source");
  assertEquals(derived.structured_data.trim, "Silverado", "value");
  assertEquals(derived.structured_data.source_value, vehicle.listing_title, "quote kept");
  assertEquals(derived.source_url, vehicle.listing_url, "listing link kept");
  assertEquals(validateObservationProperty(derived, registry, false, true).ok, true, "admitted when server-derived");
  assertEquals(validateObservationProperty(derived, registry, false, false).ok, false, "refused without the selector");
  const forged = { ...derived, structured_data: { ...derived.structured_data, trim: "Cheyenne" } };
  assertEquals(validateObservationProperty(forged, registry, false, true).ok, false, "a value absent from the quote is refused");
  assertEquals(deriveTitleFacet({ ...vehicle, is_public: false }, "trim", "2026-10-18T02:00:00.000Z"), null, "private vehicle");
});
