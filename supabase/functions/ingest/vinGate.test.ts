import { decodeVin } from "../_shared/vin-decoder.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { vinMakeCheckApplies, vinMakeConflict } from "./vinGate.ts";

Deno.test("a pre-1981 chassis number is a claim, never decoded for make", () => {
  assertEquals(vinMakeCheckApplies("GHN3L4231G"), false); // MGB-style 10-character chassis number
  assertEquals(vinMakeCheckApplies("V8/10003"), false);
  assertEquals(vinMakeCheckApplies("136806Z129844"), false); // 13-character GM-style
});

Deno.test("a 17-character VIN with a valid check digit is decoded", () => {
  assertEquals(vinMakeCheckApplies("1HGCM82633A004352"), true);
});

Deno.test("a 17-character VIN with a failing check digit is not decoded", () => {
  assertEquals(vinMakeCheckApplies("1HGCM82643A004352"), false);
  assertEquals(vinMakeCheckApplies("WP0ZZZ99ZHS116152"), false); // European VIN, no NA check digit
});

Deno.test("not a string", () => {
  assertEquals(vinMakeCheckApplies(null), false);
  assertEquals(vinMakeCheckApplies(1234567890123456), false);
});

Deno.test("actual PurpleWave EX2391 Dodge passes WMI compatibility with its full VIN", () => {
  const vin = "3C6LD5AT0CG145618", decoded = decodeVin(vin);
  assertEquals(vinMakeCheckApplies(vin), true);
  assertEquals(vinMakeConflict(vin, "Dodge", decoded), null);
  assertEquals(vinMakeConflict(vin, "RAM", decoded), null);
  assertEquals(decoded.make, null); // compatibility is not make assignment
});
Deno.test("the same valid VIN still rejects an unrelated claimed make", () => {
  const vin = "3C6LD5AT0CG145618";
  for (const make of ["Ford", "Chevrolet"])
    assertEquals(vinMakeConflict(vin, make, decodeVin(vin))?.claimed, make);
});
Deno.test("specific WMI mismatch checks and checksum eligibility remain enforced", () => {
  const vin = "1HGCM82633A004352";
  assertEquals(vinMakeConflict(vin, "Honda", decodeVin(vin)), null);
  assertEquals(vinMakeConflict(vin, "Ford", decodeVin(vin))?.expected, "Honda");
  assertEquals(vinMakeConflict("3C6LD5AT1CG145618", "Ford", decodeVin("3C6LD5AT1CG145618")), null);
});
