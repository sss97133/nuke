import {
  qualifyRetainedVinReference,
  RETAINED_VIN_MODE,
  type RetainedVinContext,
  retainedVinSelector,
} from "./retainedVinReference.ts";
import { observationContentHash } from "../_shared/observationContentHash.ts";

const assert = (ok: unknown, message = "assertion failed") => {
  if (!ok) throw new Error(message);
};
const NOW = Date.parse("2026-10-07T20:00:00Z");
const VID = "10000000-0000-0000-0000-000000000001";
const VIN = "1G1YY22G015000001"; // synthetic, never a provider call
async function fixture(
  rawChanges: Record<string, unknown> = {},
): Promise<RetainedVinContext> {
  const raw = {
    VIN,
    ErrorCode: "0",
    Make: "CHEVROLET",
    Model: "Corvette",
    ModelYear: "2001",
    BodyClass: "Coupe",
    VehicleType: "PASSENGER CAR",
    EngineCylinders: "8",
    DisplacementL: "5.7",
    DisplacementCC: "5700",
    EngineHP: "",
    Doors: "2",
    DriveType: "Not Applicable",
    ...rawChanges,
  };
  const raw_json = JSON.stringify(raw);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw_json),
  );
  const hash = Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const decoded_at = "2026-10-01T12:00:00.123456Z",
    updated_at = "2026-10-01T12:00:01.654321Z";
  return {
    revision: {
      id: 7,
      vehicle_id: VID,
      cache_vin: VIN,
      receipt: {
        method: "retained_vin_taxonomy_v1",
        reference_status: "accepted",
        input: {
          vin: VIN,
          cache_vin: VIN,
          raw_sha256: hash,
          source_recorded_at: decoded_at,
          cache_updated_at: updated_at,
        },
      },
    },
    vehicle: {
      id: VID,
      vin: VIN,
      is_public: true,
      deleted_at: null,
      listing_kind: "vehicle",
      status: "active",
    },
    cache: {
      vin: VIN,
      provider: "nhtsa",
      decoded_at,
      updated_at,
      body_type: "Coupe",
      vehicle_type: "PASSENGER CAR",
      raw_json,
    },
  };
}
async function refused(context: RetainedVinContext | null, reason: string) {
  const out = await qualifyRetainedVinReference(context, NOW);
  assert(!out.ok && out.reason === reason, JSON.stringify(out));
}

Deno.test("source selector rejects caller values, unsafe IDs and ambiguous write intent", () => {
  const body = { mode: RETAINED_VIN_MODE, revision_id: "7", dry_run: true };
  assert(retainedVinSelector(body) === "7");
  for (
    const invalid of [
      null,
      0,
      -1,
      7.5,
      "07",
      "7 OR 1=1",
      "9223372036854775808",
      9007199254740992,
    ]
  ) {
    assert(retainedVinSelector({ ...body, revision_id: invalid }) === null);
  }
  assert(
    retainedVinSelector({ ...body, fields: { EngineHP: "900" } }) === null,
  );
  assert(retainedVinSelector({ ...body, dry_run: undefined }) === null);
  assert(retainedVinSelector({ ...body, dry_run: false }) === "7");
});
Deno.test("clean retained decode keeps raw custody, source microseconds and factory role", async () => {
  const c = await fixture();
  const out = await qualifyRetainedVinReference(c, NOW);
  assert(out.ok);
  if (!out.ok) return;
  assert(
    out.receipt.physical_configuration_verified === false &&
      out.receipt.role === "factory_reference",
  );
  assert(
    out.receipt.source_recorded_at === c.cache.decoded_at &&
      out.input.observed_at === c.cache.decoded_at,
  );
  assert(
    out.receipt.fields.DisplacementL === "5.7" &&
      out.receipt.fields.EngineCylinders === "8",
  );
  assert(
    !("EngineHP" in out.receipt.fields) && !("DriveType" in out.receipt.fields),
  );
  assert(
    out.receipt.raw_reference.EngineHP === "" &&
      out.receipt.raw_reference.DriveType === "Not Applicable",
  );
  assert(
    out.input.source_vin === VIN &&
      out.input.source_vin_taxonomy_revision_id === "7",
  );
  assert(out.input.defer_analysis && out.input.agent_cost_cents === 0);
});
Deno.test("processing revisions reuse one source claim without erasing the first supporting FK", async () => {
  const a = await fixture(), b = structuredClone(a);
  b.revision.id = 9;
  b.revision.receipt.previous_projection = {
    canonical_body_style: "different",
  };
  const first = await qualifyRetainedVinReference(a, NOW),
    later = await qualifyRetainedVinReference(b, NOW);
  assert(first.ok && later.ok);
  if (!first.ok || !later.ok) return;
  assert(
    first.input.source_vin_taxonomy_revision_id !==
      later.input.source_vin_taxonomy_revision_id,
  );
  assert(first.input.source_identifier === later.input.source_identifier);
  assert(
    await observationContentHash(first.input) ===
      await observationContentHash(later.input),
  );
});
Deno.test("source content change earns a different source claim", async () => {
  const first = await qualifyRetainedVinReference(await fixture(), NOW);
  const later = await qualifyRetainedVinReference(
    await fixture({ EngineHP: "350" }),
    NOW,
  );
  assert(first.ok && later.ok);
  if (!first.ok || !later.ok) return;
  assert(first.input.source_identifier !== later.input.source_identifier);
  assert(
    await observationContentHash(first.input) !==
      await observationContentHash(later.input),
  );
});
Deno.test("a raw source mutation cannot borrow an old taxonomy hash", async () => {
  const c = await fixture();
  c.cache.raw_json = c.cache.raw_json.replace('"5.7"', '"6.2"');
  await refused(c, "reference_hash_changed");
});
Deno.test("current VIN or raw VIN changes are withheld", async () => {
  const c = await fixture();
  c.vehicle.vin = "1G1YY22G015000002";
  await refused(c, "current_vin_binding_changed");
  await refused(
    await fixture({ VIN: "1G1YY22G015000002" }),
    "raw_vin_binding_changed",
  );
});
Deno.test("partial decodes are not factory qualification", async () => {
  for (const ErrorCode of ["1,400", "4,14", "", null, 0]) {
    await refused(await fixture({ ErrorCode }), "reference_error_code");
  }
});
Deno.test("private, deleted, merged, nonvehicle and wrong parents are withheld", async () => {
  for (
    const change of [
      { is_public: false },
      { deleted_at: "2026-10-01T12:00:00Z" },
      { status: "merged" },
      { listing_kind: "non_vehicle_item" },
      { id: "10000000-0000-0000-0000-000000000002" },
    ]
  ) {
    const c = await fixture();
    Object.assign(c.vehicle, change);
    await refused(c, "parent_not_public_real_vehicle");
  }
});
Deno.test("future, malformed, missing or changed source clocks are withheld", async () => {
  for (
    const decoded_at of [null, "2026-02-30T00:00:00Z", "2027-01-01T00:00:00Z"]
  ) {
    const c = await fixture();
    c.cache.decoded_at = decoded_at;
    await refused(c, "source_clock_missing_or_future");
  }
  const c = await fixture();
  c.cache.decoded_at = "2026-10-01T12:00:00.123457Z";
  await refused(c, "reference_changed_since_taxonomy");
});
Deno.test("reference projections and qualified owner receipt cannot be forged", async () => {
  const c = await fixture();
  c.cache.body_type = "Sedan";
  await refused(c, "reference_projection_mismatch");
  const d = await fixture();
  d.revision.receipt.reference_status = "error_code";
  await refused(d, "taxonomy_reference_not_qualified");
  const e = await fixture();
  e.cache.provider = "other";
  await refused(e, "unsupported_reference_provider");
});
Deno.test("invalid numeric reference tokens are excluded while original testimony survives", async () => {
  const out = await qualifyRetainedVinReference(
    await fixture({ EngineHP: "350-400", Seats: "0", Doors: "NaN" }),
    NOW,
  );
  assert(out.ok);
  if (!out.ok) return;
  assert(
    !("EngineHP" in out.receipt.fields) &&
      out.receipt.raw_reference.EngineHP === "350-400",
  );
  assert(
    out.receipt.field_exclusions.EngineHP ===
      "unsupported_numeric_reference_value",
  );
  assert(!("Seats" in out.receipt.fields) && !("Doors" in out.receipt.fields));
});
Deno.test("unavailable source, oversize data and invalid revision IDs fail closed", async () => {
  await refused(null, "retained_reference_unavailable");
  const c = await fixture();
  c.cache.raw_json = "x".repeat(131073);
  await refused(c, "reference_body_unavailable_or_oversize");
  const d = await fixture();
  d.revision.id = -1;
  await refused(d, "invalid_taxonomy_revision");
});
