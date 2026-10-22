import { strict as assert } from "node:assert";
import { parseBatIdentityFromUrl, parseBatIdentityFromTitle } from "./batParser.ts";
import { normalizeVehicleFields } from "./normalizeVehicle.ts";
import { qualityGate } from "./extractionQualityGate.ts";
import { parseVehicleTitle } from "../ingest/vehicleTitle.ts";

// Synthetic source witnesses. These reproduce mechanisms, not a live-data census.
const options = { source: "bring_a_trailer", sourceType: "auction" as const };

Deno.test("numeric model is not a second year in BaT URL identity", () => {
  for (const prefix of ["", "no-reserve-", "30-years-owned-"]) {
    const r = parseBatIdentityFromUrl(`https://bringatrailer.com/listing/${prefix}1970-bmw-2002-and-parts-lot/`);
    assert.equal(r.year, 1970);
    assert.equal(normalizeVehicleFields({ make: r.make }).make, "BMW");
    assert.equal(r.model, "2002 And Parts Lot");
  }
});

Deno.test("joined model years remain unresolved in both intake parsers", () => {
  for (const join of ["and", "&"]) {
    const title = `1970 ${join} 1980 Honda C70 Passports`;
    assert.deepEqual(parseVehicleTitle(title), { year: null, make: null, model: null });
    const bat = parseBatIdentityFromTitle(title, "Honda");
    assert.equal(bat.make, null);
    assert.equal(bat.title, title);
    assert.equal(parseBatIdentityFromUrl(`https://bringatrailer.com/listing/1970-${join}-1980-honda-c70-passports/`).make, null);
    const input = Object.freeze({ year: 1970, make: "Honda", model: "C70 Passports", listing_title: title, sale_price: 7000 });
    const gate = qualityGate(input, options);
    assert.equal(gate.action, "reject");
    assert.notEqual(gate.identity.status, "source_claim");
    assert.deepEqual(gate.cleaned, input);
  }
});

Deno.test("conjunction is never a manufacturer even with a high completeness score", () => {
  for (const make of ["And", "or", "&"]) {
    const input = Object.freeze({ year: 2002, make, model: "Parts Lot", sale_price: 10000,
      description: "Original attributed listing text retained for review", transmission: "Manual", mileage: 10000 });
    for (const scoreOnly of [false, true]) {
      const r = qualityGate(input, { ...options, scoreOnly });
      assert.equal(r.pass, false);
      assert.equal(r.action, "reject");
      assert.ok(r.issues.includes("identity_boundary_conjunction"));
      assert.deepEqual(r.cleaned, input);
    }
    assert.equal(parseVehicleTitle(`1970 ${make} Parts Lot`).make, null);
  }
});

Deno.test("parts collections cannot be admitted as whole vehicles; explicit nonvehicle evidence survives", () => {
  const input = { year: 1970, make: "BMW", model: "2002tii Parts Collection", sale_price: 6000 };
  assert.equal(qualityGate(input, options).action, "reject");
  const retained = qualityGate({ ...input, listing_kind: "non_vehicle_item" }, options);
  assert.equal(retained.pass, true);
  assert.equal(retained.cleaned.listing_kind, "non_vehicle_item");
  assert.notEqual(retained.identity.status, "source_claim");
  const multiParts = qualityGate({ ...input, listing_title: "1970 and 1980 Honda C70 Parts Lot", listing_kind: "non_vehicle_item" }, options);
  assert.equal(multiParts.pass, true);
  assert.equal(multiParts.identity.status, "not_single_vehicle");
  assert.notEqual(multiParts.identity.status, "source_claim");
});

Deno.test("included spare parts do not turn a whole vehicle into a parts lot", () => {
  const result = qualityGate({ year: 1967, make: "Chevrolet", model: "Camaro",
    listing_title: "1967 Chevrolet Camaro with Parts Collection", sale_price: 30000 }, options);
  assert.equal(result.pass, true);
  assert.equal(result.identity.status, "source_claim");
});

Deno.test("restoration years in intake prose do not imply a multi-vehicle sale", () => {
  for (const title of ["1967 Chevrolet Camaro. Restored in 1999 and 2000",
    "1967 Chevrolet Camaro restored in 1999 and 2000"]) {
    assert.equal(parseVehicleTitle(title).make, "Chevrolet");
    const result = qualityGate({ year: 1967, make: "Chevrolet", model: "Camaro", listing_title: title }, options);
    assert.notEqual(result.action, "reject");
    assert.equal(result.identity.status, "source_claim");
  }
});

Deno.test("repeated make/model between joined years cannot certify one vehicle", () => {
  const title = "1970 Honda C70 and 1980 Honda C70";
  assert.equal(parseVehicleTitle(title).make, null);
  assert.equal(parseBatIdentityFromTitle(title).make, null);
  const result = qualityGate({ year: 1970, make: "Honda", model: "C70", listing_title: title, sale_price: 4000 }, options);
  assert.equal(result.action, "reject");
  assert.equal(result.identity.status, "unresolved");
  assert.notEqual(result.identity.status, "source_claim");
});

Deno.test("validity of labels is not verification; obscure makes, replicas and coachbuilders survive", () => {
  for (const [make, model] of [["CMC", "Speedster Replica"], ["Bultaco", "Frontera 370"], ["Datsun", "240Z"],
    ["Shelby", "Cobra Replica"], ["Austin", "Mini"], ["Zagato", "Coachbuilt Coupe"], ["MG", "B"]]) {
    const r = qualityGate({ year: 1965, make, model, sale_price: 20000 }, options);
    assert.equal(r.pass, true, make);
    assert.equal(r.identity.status, "source_claim");
    assert.equal(r.cleaned.model, model);
  }
});

Deno.test("joint normalization preserves the displaced model and is idempotent", () => {
  for (const [make, model, wantMake, wantModel] of [
    ["Pantera", "GTS", "De Tomaso", "Pantera GTS"],
    ["Scout", "II", "International Harvester", "Scout II"],
    ["Range Rover", "Classic", "Land Rover", "Range Rover Classic"],
    ["Pantera", "Pantera GTS", "De Tomaso", "Pantera GTS"],
  ]) {
    const once = normalizeVehicleFields({ make, model });
    assert.deepEqual(once, { make: wantMake, model: wantModel });
    assert.deepEqual(normalizeVehicleFields({ ...once }), once);
    assert.equal(qualityGate({ year: 1974, make, model }, options).cleaned.model, wantModel);
  }
});

Deno.test("ordinary numeric models and explicit makes retain their identity", () => {
  for (const [title, make, model] of [["1970 BMW 2002", "BMW", "2002"], ["1970 GMC Suburban", "GMC", "Suburban"],
    ["1965 Austin Mini", "Austin", "Mini"], ["1958 CMC Speedster Replica", "CMC", "Speedster Replica"]]) {
    const parsed = parseVehicleTitle(title);
    assert.equal(parsed.make, make);
    assert.equal(parsed.model, model);
  }
});

Deno.test("held listing preserves source claims in an unresolved observation and exposes retention failure", async () => {
  const { retainIdentityHold } = await import('./retainIdentityHold.ts');
  const claims = { make: 'And', model: 'Parts Lot', listing_title: '1970 and 1980 Honda C70', image_urls: ['source-image'] };
  let recorded: any;
  const receipt = await retainIdentityHold(async input => {
    recorded = input;
    return { observationId: 'obs-1', gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] };
  }, { platform: 'bat', url: 'https://bringatrailer.com/listing/fixture/' }, claims, ['multiple_model_years_unresolved']);
  assert.equal(receipt.observation_id, 'obs-1');
  assert.equal(recorded.source.sourceIdentifier, 'https://bringatrailer.com/listing/fixture/');
  assert.equal(recorded.vehicleId, null);
  assert.equal(recorded.unresolved, true);
  assert.deepEqual(recorded.rawData.source_claims, claims);
  assert.equal(recorded.hashRawData, true);
  const failed = await retainIdentityHold(async () => { throw new Error('writer unavailable'); },
    { platform: 'bat', url: 'fixture' }, claims, []);
  assert.equal(failed.observation, 'error');
  assert.equal(failed.observation_id, undefined);
});

Deno.test("held source identity separates distinct URLs and deduplicates repeated URL testimony", async () => {
  const { retainIdentityHold } = await import('./retainIdentityHold.ts');
  const receipts = new Map<string,string>();
  const writer = async (input: any) => {
    // The production writer hashes sourceIdentifier, fields, text and rawData, not source.url.
    const key = JSON.stringify([input.source.sourceIdentifier,input.fields,input.contentText,input.rawData]);
    const duplicate = receipts.has(key);
    if (!duplicate) receipts.set(key, String(receipts.size+1));
    return { observationId: receipts.get(key)!, duplicate, gapFilled: [], confirmed: [], conflicted: [], evidenceIds: [], errors: [] };
  };
  const claims = { make: 'And', model: 'Parts Lot' };
  const first = await retainIdentityHold(writer, { platform: 'bat', url: 'https://example.test/one' },claims,[]);
  const second = await retainIdentityHold(writer, { platform: 'bat', url: 'https://example.test/two' },claims,[]);
  const repeat = await retainIdentityHold(writer, { platform: 'bat', url: 'https://example.test/one' },claims,[]);
  assert.notEqual(first.observation_id,second.observation_id);
  assert.equal(first.observation_id,repeat.observation_id);
  assert.equal(repeat.observation,'duplicate');
});
