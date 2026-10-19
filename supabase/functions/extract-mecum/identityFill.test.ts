import { fillOnlyIdentity, landedStatus, vinConflictHolder } from "./identityFill.ts";

Deno.test("a lot landed after a VIN relink revision keeps the revision status", () => {
  if (landedStatus(true) !== "revision") throw new Error("relink masked as complete");
  if (landedStatus(false) !== "complete") throw new Error("plain landing not complete");
});

Deno.test("the VIN trigger's refusal is a VIN conflict and names the holder", () => {
  const holder = vinConflictHolder({ code: "23505", message: "VIN 1FMNU40L1YED53580 already exists on vehicle fd5a0e85-98be-41a8-a841-2b3c334c6a60" });
  if (holder !== "fd5a0e85-98be-41a8-a841-2b3c334c6a60") throw new Error(String(holder));
  if (vinConflictHolder({ message: "VIN 124871L510397 already exists on vehicle 9c1b61ff" }) !== "9c1b61ff") throw new Error("short id");
  if (vinConflictHolder({ code: "23505", message: 'duplicate key value violates unique constraint "vehicles_vin_unique_idx"' }) !== "") throw new Error("index");
});

Deno.test("other update errors are not VIN conflicts", () => {
  for (const err of [null, { code: "23505", message: 'duplicate key value violates unique constraint "vehicles_listing_url_key"' },
    { code: "23514", message: "vehicles_sale_price_requires_sold_status" }, { code: "57014", message: "canceling statement due to statement timeout" }]) {
    if (vinConflictHolder(err) !== null) throw new Error(JSON.stringify(err));
  }
});

Deno.test("a vehicle keeps its own identity and the lot fills only what is empty", () => {
  const r = fillOnlyIdentity({ year: 1967, make: "Chevrolet", model: null, vin: null }, { year: 1967, make: "Chevrolet", model: "Camaro", vin: "124377N100001", color: "Red" });
  if (r.disagree.length) throw new Error(JSON.stringify(r));
  if ("year" in r.update || "make" in r.update) throw new Error("overwrote year or make");
  if (r.update.model !== "Camaro" || r.update.vin !== "124377N100001" || r.update.color !== "Red") throw new Error(JSON.stringify(r.update));
});

Deno.test("a lot with another year, make or VIN is a disagreement and writes none of the identity", () => {
  const r = fillOnlyIdentity({ year: 1969, make: "Ferrari", model: "365 GT", vin: "12345" }, { year: 1956, make: "Nimbus", model: "750", vin: "99999", color: "Red" });
  if (r.disagree.join() !== "year,make,vin") throw new Error(JSON.stringify(r.disagree));
  if (["year", "make", "model", "vin"].some((k) => k in r.update)) throw new Error("identity written: " + JSON.stringify(r.update));
});

Deno.test("case, spacing and punctuation are the same identity; model never disagrees", () => {
  const r = fillOnlyIdentity({ year: 1970, make: "Pontiac", model: "GTO Judge", vin: "242370P-123456" }, { year: "1970", make: "PONTIAC", model: "GTO", vin: "242370p 123456" });
  if (r.disagree.length) throw new Error(JSON.stringify(r.disagree));
});
