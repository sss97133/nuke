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
