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

Deno.test("actual retained Lexus VINs pass without allowing a Toyota marque claim", () => {
  for (const vin of ["JTHFN48Y320004994", "JTHFN48Y640051813", "JT8CH32Y0X1002070"]) {
    const decoded = decodeVin(vin);
    assertEquals(vinMakeCheckApplies(vin), true);
    assertEquals(vinMakeConflict(vin, "Lexus", decoded), null);
    assertEquals(vinMakeConflict(vin, "Toyota", decoded)?.expected, "Lexus");
  }
});
Deno.test("retained International truck passes manufacturer compatibility without assigning a marque", () => {
  const vin = "1HTSCAAM8SH264534", decoded = decodeVin(vin);
  assertEquals(vinMakeCheckApplies(vin), true);
  assertEquals(decoded.make, null);
  assertEquals(vinMakeConflict(vin, "International", decoded), null);
  assertEquals(vinMakeConflict(vin, "Honda", decoded)?.claimed, "Honda");
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

Deno.test("the actual McCormick Maserati passes the make gate while an incompatible claim still fails", () => {
  const vin = "ZAMBC38A320008428", decoded = decodeVin(vin);
  assertEquals(vinMakeCheckApplies(vin), true);
  assertEquals(vinMakeConflict(vin, "Maserati", decoded), null);
  assertEquals(vinMakeConflict(vin, "Alfa Romeo", decoded)?.expected, "Maserati");
});
Deno.test("actual retained McCormick Bentley, DMC and Jeep claims are not contradicted by broad manufacturer guesses", () => {
  for (const [vin, make] of [['SCBCR63W84C022079', 'Bentley'], ['SCEDT26T6BD005114', 'DMC'], ['1C4BJWDG8EL322097', 'Jeep']]) {
    assertEquals(vinMakeCheckApplies(vin), true);
    assertEquals(vinMakeConflict(vin, make, decodeVin(vin)), null);
  }
  assertEquals(vinMakeConflict('SCBCR63W84C022079', 'Ford', decodeVin('SCBCR63W84C022079'))?.expected, 'Bentley');
  assertEquals(vinMakeConflict('1C4BJWDG8EL322097', 'Ford', decodeVin('1C4BJWDG8EL322097'))?.claimed, 'Ford');
  // NHTSA exact VIN is a Chrysler Prowler; preserve this source's Plymouth disagreement.
  assertEquals(vinMakeConflict('1C3EW65G92V101514', 'Plymouth', decodeVin('1C3EW65G92V101514'))?.expected, 'Chrysler');
});
