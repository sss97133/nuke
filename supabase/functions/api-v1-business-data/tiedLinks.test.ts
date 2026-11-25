// deno test supabase/functions/api-v1-business-data/tiedLinks.test.ts
// Synthetic rows only; every id below is invented.
import { keepReadableOrTiedLinks, type LinkRow, vehiclePubliclyReadable } from "./tiedLinks.ts";

function equal(actual: unknown, expected: unknown, label = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const car = (id: string, is_public: boolean | null, deleted_at: string | null = null, merged: string | null = null) => ({
  id, year: 1970, make: "Fixture", model: id, vin: `VIN-${id}`, color: "red",
  is_public, deleted_at, merged_into_vehicle_id: merged,
});
const link = (id: string, v: ReturnType<typeof car> | null, linker: string | null): LinkRow & { id: string } => ({
  id, notes: null, vehicle_id: v ? v.id : `missing-${id}`, linked_by_user_id: linker, vehicles: v,
});

// public: 01; private: 02 (tied linker), 05 (untied linker), 07 (grants call fails); deleted unmerged: 03 (no linker,
// grants true); deleted and merged (a public redirect): 04; car row missing: 06.
const rows = [
  link("01", car("c1", true), "u-any"),
  link("02", car("c2", false), "u-tied"),
  link("03", car("c3", true, "2026-01-01"), null),
  link("04", car("c4", true, "2026-01-01", "c1"), "u-any"),
  link("05", car("c5", false), "u-untied"),
  link("06", null, "u-tied"),
  link("07", car("c7", null), "u-error"),
];
const calls: string[] = [];
const grants = async (vehicleId: string, linker: string | null) => {
  calls.push(`${vehicleId}:${linker}`);
  if (linker === "u-error") return null;
  return linker === null || linker === "u-tied";
};

Deno.test("public predicate matches vehicle_publicly_readable", () => {
  equal(vehiclePubliclyReadable(car("a", true)), true, "public");
  equal(vehiclePubliclyReadable(car("a", false)), false, "private");
  equal(vehiclePubliclyReadable(car("a", null)), false, "null is_public");
  equal(vehiclePubliclyReadable(car("a", true, "2026-01-01")), false, "deleted");
  equal(vehiclePubliclyReadable(car("a", true, "2026-01-01", "b")), true, "deleted and merged");
  equal(vehiclePubliclyReadable(null), false, "missing car");
});

Deno.test("keeps public and tied links, drops untied, missing and failed ones", async () => {
  calls.length = 0;
  const kept = await keepReadableOrTiedLinks(rows, grants, 2);
  equal(kept.map((r) => r.id), ["01", "02", "03", "04"], "kept");
  equal(calls.sort(), ["c2:u-tied", "c3:null", "c5:u-untied", "c7:u-error"], "grants asked only for cars the public cannot read");
});

Deno.test("returned rows carry no gate columns and the embed keeps its shape", async () => {
  const kept = await keepReadableOrTiedLinks(rows.slice(0, 1), grants);
  equal(kept[0], { id: "01", notes: null, vehicles: { id: "c1", year: 1970, make: "Fixture", model: "c1", vin: "VIN-c1", color: "red" } }, "shape");
});

Deno.test("a private car's VIN never leaves through an untied link", async () => {
  const kept = await keepReadableOrTiedLinks(rows, grants);
  equal(JSON.stringify(kept).includes("VIN-c5"), false, "untied private VIN");
  equal(JSON.stringify(kept).includes("VIN-c7"), false, "failed-grants VIN");
});
