/**
 * Phase 1 — evidence-class binding tests (the anti-laundering rule).
 *
 * Pure unit tests over the registry; no DB. The headline guarantee the prompt asks
 * for: a photo-cited horsepower claim is rejected, a VIN-decode-cited one is accepted.
 *
 * Run: deno test supabase/functions/_shared/cockpit/attribute-registry.evidence.test.ts
 */

import {
  validateEvidenceClass,
  admissibleEvidence,
  getAttribute,
  listAttributes,
  EVIDENCE_CLASSES,
} from "./attribute-registry.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test("HEADLINE: a photo cannot cite horsepower (rejected)", () => {
  const err = validateEvidenceClass("vehicle.horsepower", "image");
  assert(err !== null, "image-cited horsepower MUST be rejected");
  assert(/not admissible/.test(err!), `expected an admissibility error, got: ${err}`);
});

Deno.test("HEADLINE: a VIN decode CAN cite horsepower (accepted)", () => {
  assert(validateEvidenceClass("vehicle.horsepower", "vin_decode") === null, "vin_decode-cited horsepower must be accepted");
});

Deno.test("spec facts (torque/displacement) reject image, accept vin_decode/document/owner_claim", () => {
  for (const attr of ["vehicle.torque", "vehicle.displacement"]) {
    assert(validateEvidenceClass(attr, "image") !== null, `${attr}: image must be rejected`);
    assert(validateEvidenceClass(attr, "vin_decode") === null, `${attr}: vin_decode must be accepted`);
    assert(validateEvidenceClass(attr, "document") === null, `${attr}: document must be accepted`);
    assert(validateEvidenceClass(attr, "owner_claim") === null, `${attr}: owner_claim must be accepted`);
  }
});

Deno.test("current color is image-class, NOT vin_decode (a decode can't show refinished paint)", () => {
  assert(validateEvidenceClass("vehicle.exterior_color", "image") === null, "image must cite current color");
  assert(validateEvidenceClass("vehicle.exterior_color", "vin_decode") !== null, "vin_decode must NOT cite current color");
});

Deno.test("seat_count accepts both image and vin_decode", () => {
  assert(validateEvidenceClass("vehicle.seat_count", "image") === null, "image counts seats");
  assert(validateEvidenceClass("vehicle.seat_count", "vin_decode") === null, "vin_decode derives seats from body style");
});

Deno.test("owner_claim is the universal low-tier fallback where bound", () => {
  // It is admissible for owner-assertable attributes...
  assert(validateEvidenceClass("vehicle.modifications", "owner_claim") === null, "owner may claim mods");
  // ...but NOT silently admissible for pure-vision detection tasks.
  assert(validateEvidenceClass("image.has_vehicle", "owner_claim") !== null, "owner_claim should not cite a vision detection task");
});

Deno.test("unknown evidence class is rejected", () => {
  assert(validateEvidenceClass("vehicle.horsepower", "vibes") !== null, "unknown class must be rejected");
  assert(validateEvidenceClass("vehicle.horsepower", 42) !== null, "non-string class must be rejected");
});

Deno.test("unknown attribute is rejected", () => {
  assert(validateEvidenceClass("vehicle.nonexistent", "owner_claim") !== null, "unknown attribute must be rejected");
});

Deno.test("the 4 spec attributes exist in the registry", () => {
  for (const a of ["vehicle.horsepower", "vehicle.torque", "vehicle.displacement", "vehicle.seat_count"]) {
    assert(getAttribute(a) !== null, `${a} must be registered`);
  }
});

Deno.test("every registered attribute resolves a non-empty, valid admissible set", () => {
  for (const attr of listAttributes()) {
    const adm = admissibleEvidence(attr);
    assert(adm.length > 0, `${attr} has no admissible evidence — would be unsubmittable`);
    for (const c of adm) {
      assert(EVIDENCE_CLASSES.includes(c), `${attr} lists invalid evidence class '${c}'`);
    }
  }
});

Deno.test("INVARIANT: no factory-spec attribute admits image evidence", () => {
  // The whole point — spec facts must never be citable by a photograph.
  for (const attr of ["vehicle.horsepower", "vehicle.torque", "vehicle.displacement"]) {
    assert(!admissibleEvidence(attr).includes("image"), `${attr} must NOT admit image evidence`);
  }
});
