import { fillOnlyIdentity } from "./identityFill.ts";

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
