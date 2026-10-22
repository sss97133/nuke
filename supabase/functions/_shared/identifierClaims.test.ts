import { assertEquals } from "jsr:@std/assert@1";
import { readIdentifierClaims } from "./identifierClaims.ts";

// Real 356 description excerpts from prod vehicles (ids in comments), read 2026-10-22.
Deno.test("356SC Karmann bullet list (00fe5725): chassis, engine, matching", () => {
  const r = readIdentifierClaims("• Chassis No. 216391\n• Engine No. 810790\n• Body by Karmann\n• Matching numbers 'Super C' engine");
  assertEquals(r.identifiers.filter((i) => i.kind === "chassis").map((i) => i.value), ["216391"]);
  assertEquals(r.identifiers.filter((i) => i.kind === "engine").map((i) => i.value), ["810790"]);
  assertEquals(r.numbers_claim, "matching");
});
Deno.test("356C Kardex prose (01fb2c13): engine/trans numbers and kardex", () => {
  const r = readIdentifierClaims("The seller adds that the engine and transmission stampings match those identified on the Kardex, with engine #713209 and transmission #78250.");
  assertEquals(r.identifiers.find((i) => i.kind === "engine")?.value, "713209");
  assertEquals(r.identifiers.find((i) => i.kind === "transmission")?.value, "78250");
  assertEquals(r.documented_by, ["kardex"]);
});
Deno.test("356A Speedster quoted chassis (031c76f6): speedster, kardex, matching", () => {
  const r = readIdentifierClaims("Its factory Kardex reveals that this Porsche 356A Speedster, chassis number '82782', was delivered on 26th November 1956. The car retains fully matching numbers and colours.");
  assertEquals(r.identifiers.find((i) => i.kind === "chassis")?.value, "82782");
  assertEquals(r.body_style, "SPEEDSTER");
  assertEquals(r.numbers_claim, "matching");
  assertEquals(r.is_replica, false);
});
Deno.test("Convertible D (0300823c) wins over Speedster mention", () => {
  const r = readIdentifierClaims("built using the same 356A styling as the final Speedsters. Of the three versions ..., the Convertible D is the rarest.");
  assertEquals(r.body_style, "CONVERTIBLE_D");
});
Deno.test("replica flagged, non-matching wins", () => {
  const r = readIdentifierClaims("1957 Speedster replica by Vintage Speedsters, VW-based. Non-matching engine.");
  assertEquals(r.is_replica, true);
  assertEquals(r.numbers_claim, "non_matching");
});
Deno.test("replica wheels and 'a tribute to precision' are not replica cars", () => {
  assertEquals(readIdentifierClaims("Chromed Brazilian replica wheels wear matching caps. Every mile a tribute to precision.").is_replica, false);
  assertEquals(readIdentifierClaims("This Porsche 356 Roadster replica was manufactured by Intermeccanica in 2018").is_replica, true);
});
Deno.test("body precedence: title beats Speedster heritage prose; rule beats text", () => {
  const prose = "built with the same chassis as the final Speedsters and the Speedster lineage";
  assertEquals(readIdentifierClaims(prose, { title: "1964 Porsche 356C Coupe" }).body_style, "COUPE");
  assertEquals(readIdentifierClaims("a lovely Speedster-inspired car", { bodyFromRule: "COUPE" }).body_style, "COUPE");
  assertEquals(readIdentifierClaims("a lovely Speedster", {}).body_style_basis, "text");
});
