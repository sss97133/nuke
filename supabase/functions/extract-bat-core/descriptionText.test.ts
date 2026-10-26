import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fullDescriptionText, isLegacyTruncatedSummary, legacySummaryOf, shouldReplaceDescription } from "./descriptionText.ts";

const body = ("This 1967 Porsche 911 coupe shows rust in the floor pans and needs paint. ").repeat(20);
const full = fullDescriptionText(body)!;
const cut = legacySummaryOf(full);

Deno.test("full text is never truncated", () => {
  assertEquals(full.length > 480, true);
  assertEquals(full.endsWith("…"), false);
});
Deno.test("legacy cut is detected", () => {
  assertEquals(cut.length <= 481 && cut.endsWith("…"), true);
  assertEquals(isLegacyTruncatedSummary(cut), true);
  assertEquals(isLegacyTruncatedSummary(full), false);
});
Deno.test("replace only the legacy cut of the same body", () => {
  assertEquals(shouldReplaceDescription(cut, full), true);
  assertEquals(shouldReplaceDescription(null, full), true);
  assertEquals(shouldReplaceDescription(full + " more", full), false);
  assertEquals(shouldReplaceDescription(legacySummaryOf("Different text. ".repeat(40).trim()), full), false);
});
