// Contract for maskOwnerMoney: the public API masks a vehicle's owner money (purchase_price, purchase_date,
// purchase_location) for every caller but the owner and the service role, the same rule as vehicle_owner_books
// (#1164). Run: deno test supabase/functions/_shared/ownerMoney.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { maskOwnerMoney } from "./ownerMoney.ts";

const OWNER = "11111111-1111-1111-1111-111111111111";
const STRANGER = "22222222-2222-2222-2222-222222222222";

function row() {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    make: "Porsche",
    is_public: true,
    owner_id: OWNER,
    sale_price: 90000,
    purchase_price: 42000,
    purchase_date: "2024-03-01",
    purchase_location: "Reno, NV",
  };
}

Deno.test("a stranger's API key gets the money fields nulled, nothing else changed", () => {
  const masked = maskOwnerMoney(row(), STRANGER, false);
  assertEquals(masked.purchase_price, null);
  assertEquals(masked.purchase_date, null);
  assertEquals(masked.purchase_location, null);
  // Everything public is untouched.
  assertEquals(masked.make, "Porsche");
  assertEquals(masked.sale_price, 90000);
  assertEquals(masked.is_public, true);
  assertEquals(masked.owner_id, OWNER);
});

Deno.test("an anonymous caller (no user id) gets the money nulled", () => {
  const masked = maskOwnerMoney(row(), null, false);
  assertEquals(masked.purchase_price, null);
  assertEquals(masked.purchase_date, null);
  assertEquals(masked.purchase_location, null);
});

Deno.test("the owner keeps the money", () => {
  const masked = maskOwnerMoney(row(), OWNER, false);
  assertEquals(masked.purchase_price, 42000);
  assertEquals(masked.purchase_date, "2024-03-01");
  assertEquals(masked.purchase_location, "Reno, NV");
});

Deno.test("the service role keeps the money even with no user id", () => {
  const masked = maskOwnerMoney(row(), null, true);
  assertEquals(masked.purchase_price, 42000);
  assertEquals(masked.purchase_location, "Reno, NV");
});

Deno.test("a row that never selected owner_id is masked for a stranger (fail closed)", () => {
  const partial = { id: "x", make: "BMW", purchase_price: 15000 } as Record<string, unknown>;
  const masked = maskOwnerMoney(partial, STRANGER, false);
  assertEquals(masked.purchase_price, null);
  assertEquals(masked.make, "BMW");
});

Deno.test("the input row is not mutated", () => {
  const original = row();
  maskOwnerMoney(original, STRANGER, false);
  assertEquals(original.purchase_price, 42000);
});

Deno.test("absent money keys are not added", () => {
  const masked = maskOwnerMoney({ id: "x", owner_id: OWNER, make: "Ford" }, STRANGER, false) as Record<string, unknown>;
  assertEquals("purchase_price" in masked, false);
  assertEquals("purchase_date" in masked, false);
});
