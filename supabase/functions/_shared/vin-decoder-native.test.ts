import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decodeVin } from "./vin-decoder.ts";
// Synthetic VIN-shaped strings exercise WMI interpretation only, not a real car.
const vin = (wmi: string) => wmi + "ZZZZZ0X0000000";
Deno.test("Nissan manufacture preserves Infiniti and historical Datsun marque uncertainty", () => {
  for (const value of ["JNKCV66E09M722027", "JNKCV64E49M604114"]) assertEquals(decodeVin(value).make, "Infiniti");
  const datsun = decodeVin("JN1HT02S8BT202355");
  assertEquals(datsun.make, null);
  assertEquals(datsun.manufacturer, "NISSAN MOTOR COMPANY, LTD");
  assertEquals(datsun.manufacturer_make_candidates, ["Nissan", "Infiniti", "Datsun"]);
  const nissan = decodeVin("JN8AS5MT9FW153681");
  assertEquals(nissan.make, null);
  assertEquals(nissan.manufacturer_make_candidates, ["Nissan", "Infiniti"]);
  assertEquals(decodeVin(vin("JNZ")).make, null);
});
Deno.test("Toyota manufacture preserves Lexus marque and multi-marque WMI uncertainty", () => {
  // Both actual retained McCormick VINs decode cleanly to Lexus in NHTSA vPIC.
  for (const value of ["JTHFN48Y320004994", "JTHFN48Y640051813", "JT8CH32Y0X1002070", vin("JTJ")]) {
    assertEquals(decodeVin(value).make, "Lexus");
    assertEquals(decodeVin(value).manufacturer, "TOYOTA MOTOR CORPORATION");
  }
  assertEquals(decodeVin(vin("JTD")).make, "Toyota");
  assertEquals(decodeVin(vin("JTE")).make, null);
  assertEquals(decodeVin(vin("JTE")).manufacturer_make_candidates, ["Toyota", "Lexus", "Subaru"]);
  assertEquals(decodeVin(vin("JTM")).make, null);
  assertEquals(decodeVin(vin("JTM")).manufacturer_make_candidates, ["Toyota", "Subaru"]);
  assertEquals(decodeVin(vin("JTZ")).make, null);
});
Deno.test("1H alone does not establish Honda while specific truck manufacturer stays multi-marque", () => {
  assertEquals(decodeVin("1HGCM82633A004352").make, "Honda");
  const decoded = decodeVin("1HTSCAAM8SH264534");
  assertEquals(decoded.make, null);
  assertEquals(decoded.manufacturer, "INTERNATIONAL MOTORS, LLC");
  assertEquals(decoded.manufacturer_make_candidates, ["Chevrolet", "Navistar", "Caterpillar", "IC Bus", "Workhorse", "International", "GM"]);
  assertEquals(decodeVin(vin("1HZ")).make, null);
});
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
