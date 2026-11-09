import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decodeVin } from "./vin-decoder.ts";
// Synthetic VIN-shaped strings exercise WMI interpretation only, not a real car.
const vin = (wmi: string) => wmi + "ZZZZZ0X0000000";
Deno.test("NHTSA-supported Canadian Pontiac WMI is distinct from Chevrolet", () => {
  assertEquals(decodeVin(vin("2G2")).make, "Pontiac");
  assertEquals(decodeVin(vin("1G2")).make, "Pontiac");
  assertEquals(decodeVin(vin("1G1")).make, "Chevrolet");
});
Deno.test("an OEM-only GM prefix preserves manufacturer and unknown marque", () => {
  for (const prefix of ["1GZ", "2GZ", "3GZ"]) assertEquals(decodeVin(vin(prefix)).make, null);
});

Deno.test("3C6 retains manufacturer without falsely projecting Chrysler as the marque", () => {
  const decoded = decodeVin("3C6LD5AT0CG145618");
  assertEquals(decoded.make, null);
  assertEquals(decoded.manufacturer, "CHRYSLER DE MEXICO TOLUCA");
  assertEquals(decoded.manufacturer_make_candidates, ["Dodge", "Chrysler", "Volkswagen", "Jeep", "Fiat", "RAM", "Lancia"]);
});

Deno.test("specific Italian WMIs distinguish Maserati from Alfa Romeo without guessing other ZA marques", () => {
  // NHTSA vPIC decodes the actual McCormick15440 VIN as a 2002 Maserati Coupe.
  const decoded = decodeVin("ZAMBC38A320008428");
  assertEquals(decoded.make, "Maserati");
  assertEquals(decoded.manufacturer, "MASERATI S.P.A.");
  assertEquals(decodeVin(vin("ZAR")).make, "Alfa Romeo");
  assertEquals(decodeVin(vin("ZAP")).make, null);
});

Deno.test("SC is not a Lotus identifier: actual Bentley is specific, other SC identifiers stay unknown", () => {
  assertEquals(decodeVin("SCBCR63W84C022079").make, "Bentley");
  assertEquals(decodeVin(vin("SCC")).make, "Lotus");
  assertEquals(decodeVin("SCEDT26T6BD005114").make, null);
  assertEquals(decodeVin(vin("SCZ")).make, null);
});
Deno.test("1C4 preserves manufacturer compatibility without assigning Jeep or Chrysler as the marque", () => {
  const decoded = decodeVin("1C4BJWDG8EL322097");
  assertEquals(decoded.make, null);
  assertEquals(decoded.manufacturer, "FCA US LLC");
  assertEquals(decoded.manufacturer_make_candidates, ['Dodge', 'Chrysler', 'Volkswagen', 'Jeep', 'Fiat', 'RAM', 'Lancia']);
});
