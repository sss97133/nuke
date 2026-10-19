import { assertEquals } from "jsr:@std/assert@1";
import { forcedVehicleId, pickVehicleTarget } from "./vehicleTarget.ts";

const A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

Deno.test("a forced vehicle id wins over the queue, URL and VIN lookups", () => {
  assertEquals(pickVehicleTarget({ forced: A, queue: B, url: B, vin: B }), { kind: "forced", id: A });
});

Deno.test("a forced vehicle id never yields a new vehicle", () => {
  for (const others of [{}, { queue: null, url: null, vin: null }, { url: B }]) {
    const t = pickVehicleTarget({ forced: A, ...others });
    assertEquals(t.kind, "forced");
  }
});

Deno.test("without a forced id: queue, then URL, then VIN, else new", () => {
  assertEquals(pickVehicleTarget({ queue: A, url: B }), { kind: "found", id: A });
  assertEquals(pickVehicleTarget({ url: B, vin: A }), { kind: "found", id: B });
  assertEquals(pickVehicleTarget({ vin: A }), { kind: "found", id: A });
  assertEquals(pickVehicleTarget({}), { kind: "new" });
});

Deno.test("only a uuid vehicle_id forces a vehicle", () => {
  assertEquals(forcedVehicleId({ vehicle_id: A }), A);
  assertEquals(forcedVehicleId({ vehicle_id: A.toUpperCase() }), A);
  assertEquals(forcedVehicleId({ vehicle_id: "not-a-uuid" }), undefined);
  assertEquals(forcedVehicleId({ vehicle_id: 42 }), undefined);
  assertEquals(forcedVehicleId({}), undefined);
  assertEquals(forcedVehicleId(null), undefined);
});
