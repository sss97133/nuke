import { assertEquals } from "jsr:@std/assert";
import { checkBinding, parseConceptcarzTitle } from "./conceptcarz-binding-audit.ts";

const v = (year: number, make: string, model: string, vin: string | null = null) => ({ year, make, model, vin });

Deno.test("parses year, make, model and a full chassis from a conceptcarz title", () => {
  assertEquals(parseConceptcarzTitle("1956 FORD F-100 CUSTOM PICKUPChassis#: F10D6R35426", "Ford"),
    { year: 1956, make: "Ford", model: "F-100 CUSTOM PICKUP", vin: "F10D6R35426" });
  assertEquals(parseConceptcarzTitle("1972 CHEVROLET CAMARO SS CUSTOM COUPEChassis#: 1Q8", "Chevrolet").vin, null);
});

Deno.test("flags archive rows that name a different car (sampled 2026-10-18)", () => {
  for (const [veh, title] of [
    [v(1956, "Ford", "Thunderbird Convertible"), "1956 FORD F-100 CUSTOM PICKUPChassis#: F10D6R35426"],
    [v(1994, "Chevrolet", "Corvette '572' Custom Coupe"), "1994 Chevrolet Caprice SS Station Wagon"],
    [v(1964, "Ford", "F-100 Custom Pickup"), "1964 FORD THUNDERBIRD TWO DOOR HARDTOP"],
    [v(1956, "Chevrolet", "Bel Air Convertible"), "1956 Chevrolet 210 Wagon"],
    [v(1970, "Oldsmobile", "442 W-30 Holiday Coupe"), "1970 OLDSMOBILE TORONADO GTChassis#: 394870M605890"],
    [v(1966, "Pontiac", "Lemans Convertible"), "1966 Pontiac GTO Hardtop"],
    [v(1960, "Ford", "Falcon Custom 2-Door Sedan"), "1960 FORD THUNDERBIRD CONVERTIBLEChassis#: OY73Y112727"],
  ] as const) assertEquals(checkBinding(veh, title).conflict !== null, true, title);
});

Deno.test("keeps archive rows of the same car", () => {
  assertEquals(checkBinding(v(1954, "Ford", "F-100 Step-side Custom Pickup"), "1954 Ford F100 Pickup").conflict, null);
  assertEquals(checkBinding(v(1959, "Chevrolet", "Corvette Convertible"), "1959 Corvette Convertible Painting").conflict, null);
  assertEquals(checkBinding(v(1965, "Ford", "Mustang Fastback"), "1965 FORD MUSTANG FASTBACK").conflict, null);
});

Deno.test("a missing model never disagrees (fill-only rule)", () => {
  assertEquals(checkBinding(v(1965, "Ford", ""), "1965 FORD MUSTANG").conflict, null);
});
