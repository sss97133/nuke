import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { purplewaveDescription } from "./purplewaveDescription.ts";
const vin = "1GT19LE74NF216181";
Deno.test("native GMC VIN and labeled description agree; prose renders as text", () => {
  const html = `<b>2022 GMC Sierra 2500HD</b><br/><ul><li>Miles: 107,180 on odometer</li><li>VIN: ${vin}</li></ul><em>Texas title</em>`;
  const result = purplewaveDescription(html, vin);
  assertEquals(result.vin, vin);
  assertEquals(result.description, `2022 GMC Sierra 2500HD\nMiles: 107,180 on odometer\nVIN: ${vin}\nTexas title`);
  assertEquals(result.vin_evidence.status, "validated_explicit");
});
Deno.test("explicit description VIN is usable without the optional native field", () => {
  assertEquals(purplewaveDescription(`<ul><li>VIN: ${vin.toLowerCase()}</li></ul>`, null).vin, vin);
});
Deno.test("serials and unlabelled tokens are never vehicle identity", () => {
  assertEquals(purplewaveDescription(`<li>Serial: ${vin}</li>`, null).vin, null);
  assertEquals(purplewaveDescription(vin, null).vin, null);
});
Deno.test("conflicting or invalid VIN testimony is retained but not projected", () => {
  const invalid = "1GT19LE75NF216181";
  assertEquals(purplewaveDescription(`<li>VIN: ${vin}</li>`, invalid).vin_evidence.status, "conflicting_explicit_values");
  const result = purplewaveDescription(null, invalid);
  assertEquals(result.vin, null);
  assertEquals(result.vin_evidence.candidates, [invalid]);
});
Deno.test("plain text entities and missing prose use the existing safe text utility", () => {
  assertEquals(purplewaveDescription('<p>AC &amp; Heat</p><p>Title &lt;em&gt;pending&lt;/em&gt;</p>', null).description, 'AC & Heat\nTitle pending');
  assertEquals(purplewaveDescription(null, null).description, null);
});
