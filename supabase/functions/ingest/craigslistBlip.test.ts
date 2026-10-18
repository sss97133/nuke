// Run: deno test --allow-env supabase/functions/ingest/craigslistBlip.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { landCraigslistBlip, modelFromText } from "./craigslistBlip.ts";

Deno.test("a model stated next to the year and make is read, with the span it came from", () => {
  const text = "NEED GONE !!!  MAKE OFFER!!!!!!     1987 GMC C7000 Series 2 TON  366 Log Truck";
  const m = modelFromText(text, 1987, "GMC")!;
  assertEquals(m.value, "C7000");
  assertEquals(m.rule, "year_make_token");
  assertEquals(text.slice(m.span.start, m.span.end), m.span.text);
  assertEquals(m.span.text, "1987 GMC C7000");
});

Deno.test("a letter-and-digit token after the year is a model when the make is not repeated in the text", () => {
  const m = modelFromText("1966 F100 V8 351 Automatic was painted some years back", 1966, "Ford")!;
  assertEquals(m.value, "F100");
  assertEquals(m.rule, "year_token");
});

Deno.test("nothing is read when the text names no such token", () => {
  assertEquals(modelFromText("1 owner, pre-smog Datsun long bed, 103k miles", 1975, "Datsun"), null);
  assertEquals(modelFromText("1966 351 Automatic", 1966, "Ford"), null);
  assertEquals(modelFromText("75 datsun long bed", 1975, "Datsun"), null);
  assertEquals(modelFromText("", 1975, "Datsun"), null);
});

Deno.test("an unresolved post is written as a listing observation with no vehicle, carrying its text and photos", async () => {
  let seen: any = null;
  const landing = await landCraigslistBlip(
    { supabase: {}, writeObservation: async (_s, input) => { seen = input; return { observationId: "obs-1", gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] }; } },
    {
      listingUrl: "https://www.craigslist.org/view/d/lodi-75-datsun/hGPAXERnRg2hyZusG8tmYT",
      capture: { post_id: "7976606571", posted_at: "2026-10-02T12:42:22.000Z", updated_at: null,
        attributes: { odometer: 103552, title_status: "clean", raw: { makemodel: "datsun" } },
        source_capture: { snapshot_id: "s1", observed_at: "2026-10-15T00:36:47.025Z" }, asking_price: 4500,
        place: { locality: "Lodi", region: "CA", postal_code: "95240", country: "US", latitude: 38.1, longitude: -121.3 } } as any,
      year: 1975, make: "Datsun", description: "1 owner, pre-smog Datsun long bed", imageUrls: ["https://images.craigslist.org/a_600x450.jpg"],
    },
  );
  assertEquals(landing.observation, "written");
  assertEquals(seen.vehicleId, null);
  assertEquals(seen.unresolved, true);
  assertEquals(seen.observationKind, "listing");
  assertEquals(seen.contentText, "1 owner, pre-smog Datsun long bed");
  assertEquals(seen.fields.year_claim, 1975);
  assertEquals(seen.fields.makemodel_text, "datsun");
  assertEquals(seen.fields.place_region, "CA");
  assertEquals(seen.fields.unresolved_reason, "model_not_stated");
  assertEquals(seen.rawData.image_urls.length, 1);
  assertEquals(seen.observedAt, "2026-10-15T00:36:47.025Z");
});
