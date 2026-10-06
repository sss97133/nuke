// Run: deno test --allow-read supabase/functions/extract-vehicle-data-ai/priceColumns.test.ts
import { listingPriceColumns } from "./priceColumns.ts";
import { insertRefusal } from "./insertRefusal.ts";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("a listing that shows only a price writes the ask to asking_price and leaves sale_price null", () => {
  equal(listingPriceColumns({ price: 27500, sold_price: null }), { sale_price: null, asking_price: 27500 });
  equal(listingPriceColumns({ price: 27500 }), { sale_price: null, asking_price: 27500 });
});

Deno.test("a listing that states a sale writes sale_price; the ask stays in asking_price", () => {
  equal(listingPriceColumns({ price: 30000, sold_price: 28500 }), { sale_price: 28500, asking_price: 30000 });
});

Deno.test("a stated sale with no ask leaves asking_price null", () => {
  equal(listingPriceColumns({ price: null, sold_price: 28500 }), { sale_price: 28500, asking_price: null });
});

Deno.test("no price, or a zero price, writes neither column", () => {
  equal(listingPriceColumns({}), { sale_price: null, asking_price: null });
  equal(listingPriceColumns({ price: 0, sold_price: 0 }), { sale_price: null, asking_price: null });
});

Deno.test("the extractor builds its vehicle payload from that rule, not from an inline price mapping", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  if (!source.includes("...listingPriceColumns(normalized)")) {
    throw new Error("index.ts must take sale_price and asking_price from listingPriceColumns(normalized)");
  }
  if (/sale_price\s*:\s*normalized\.sold_price\s*\|\|\s*normalized\.price/.test(source)) {
    throw new Error("index.ts maps the listing price into sale_price again");
  }
});

// The guard's real refusal: SQLSTATE 23514 from guard_vehicle_sale_price (migration 20260927170000).
const GUARD_REFUSAL = {
  code: "23514",
  message: "vehicles.sale_price = 28500 refused for 4a040922-a6c7-4c61-9341-918066aa44ca: no sold status (sale_status = 'available', auction_outcome = NULL)",
  details: "A price alone is a bid, an ask or an estimate, never a sale (vehicle_sale_basis, 2026-09-27).",
  hint: "Write a quote to asking_price and a bid to high_bid / winning_bid.",
};

Deno.test("a refused vehicle insert is returned to the caller as success false with the database's own message, not swallowed into success", () => {
  const extracted = { year: 1978, make: "Chevrolet", price: 28500 };
  const refusal = insertRefusal(GUARD_REFUSAL, extracted, "https://example.test/listing/1");
  equal(refusal.status, 422);
  equal(refusal.body.success, false);
  equal(refusal.body.vehicle_id, null);
  equal(refusal.body.error, `Vehicle insert refused: ${GUARD_REFUSAL.message}`);
  equal(refusal.body.error_code, "23514");
  equal(refusal.body.error_hint, GUARD_REFUSAL.hint);
  equal(refusal.body.data, extracted);
  equal(refusal.body.url, "https://example.test/listing/1");
  equal("error_details" in refusal.body, false); // Postgres puts the offending row values in details
});

Deno.test("any other insert error is returned too; a database fault is a 500, a missing message still says why", () => {
  const timeout = insertRefusal({ code: "57014", message: "canceling statement due to statement timeout" }, {}, "u");
  equal(timeout.status, 500);
  equal(timeout.body.success, false);
  equal(timeout.body.error, "Vehicle insert refused: canceling statement due to statement timeout");
  const duplicate = insertRefusal({ code: "23505", message: 'duplicate key value violates unique constraint "vehicles_vin_key"' }, {}, "u");
  equal(duplicate.status, 422);
  const silent = insertRefusal({}, {}, "u");
  equal(silent.status, 500);
  equal(silent.body.success, false);
  equal(silent.body.error, "Vehicle insert refused: the database gave no message");
  equal(silent.body.error_code, null);
});

Deno.test("a refusal is never read as a non-vehicle page by process-import-queue, so it is retried and then failed, not skipped", () => {
  // process-import-queue marks a row skipped when the error contains any of these.
  const skipMarkers = ["No vehicle data found", "could not find real vehicle data", "Missing required fields"];
  const refusal = insertRefusal(GUARD_REFUSAL, {}, "u");
  for (const marker of skipMarkers) {
    if (String(refusal.body.error).includes(marker)) {
      throw new Error(`refusal text contains the skip marker ${JSON.stringify(marker)}`);
    }
  }
});

Deno.test("the insert site returns the refusal and stops, instead of logging and falling through to success", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const branch = source.match(/if \(insertErr\) \{([\s\S]*?)\n\s*\} else if \(inserted\?\.id\)/);
  if (!branch) throw new Error("the insertErr branch was not found in index.ts");
  if (!branch[1].includes("insertRefusal(insertErr")) throw new Error("the insertErr branch does not build the refusal");
  if (!/return new Response\(JSON\.stringify\(refusal\.body\)/.test(branch[1])) {
    throw new Error("the insertErr branch does not return the refusal body");
  }
  if (!/status:\s*refusal\.status/.test(branch[1])) throw new Error("the insertErr branch does not return the refusal status");
});
