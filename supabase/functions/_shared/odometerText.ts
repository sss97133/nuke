// Odometer-from-prose: a number counts as an odometer reading only in odometer context.
import { type Odometer, unitFromText } from "./odometer.ts";

const ODO_NUM = String.raw`(\d{1,3}(?:[,.\u00a0 ]\d{3})+|\d{1,7})`;
const ODO_UNIT = String.raw`(km|kms|kilomet(?:er|re)s?|miles?|mi)\b`;
// Words that make a number an odometer reading rather than a speed, economy figure or distance.
const ODO_CONTEXT = /\b(odometer|odo|mileage|indicat\w*|recorded|showing|shows|displays?|reads?|reading|covered|from new|since new|total|genuine|actual|original|documented|warranted|believed)\b/i;
// Unit continuations that mean the figure is not an odometer reading.
const NOT_ODO_AFTER = /^\s*(\/\s*h|p\/?h|per\s+(hour|gallon|litre|liter|tank)|an?\s+hour|in\s+an?\s+hour|to\s+the\s+gallon|on\s+a\s+(tank|gallon)|away|north|south|east|west|from\s+(the|its)\s+(factory|works|town|city|circuit))/i;
const NOT_ODO_BEFORE = /(top\s+speed|maximum\s+speed|speeds?\s+of|capable\s+of|reach(?:ed|ing)?|mpg|economy|range\s+of|race|rally|lap|journey|drove|driven\s+to|trip)\s*(?:of|at|in excess of|over|around|some|nearly|almost)?\s*$/i;

/** Odometer reading from free text, or null. Requires odometer context words near the number. */
export function extractOdometerFromText(text: string): Odometer | null {
  const labelled = new RegExp(String.raw`\b(?:odometer|mileage|odo)\b[^.:\d]{0,30}:?\s*` + ODO_NUM + String.raw`(?:\s*` + ODO_UNIT + ")?", "ig");
  const plain = new RegExp(ODO_NUM + String.raw`\s*` + ODO_UNIT, "ig");
  for (const re of [labelled, plain]) {
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const before = text.slice(Math.max(0, at - 60), at);
      const after = text.slice(at + m[0].length, at + m[0].length + 25);
      if (NOT_ODO_AFTER.test(after) || /mpg|km\/h|mph|kph/i.test(m[0] + after.slice(0, 4))) continue;
      if (re === plain && (NOT_ODO_BEFORE.test(before) || !ODO_CONTEXT.test(before + " " + after))) continue;
      const num = parseInt(m[1].replace(/\D/g, ""));
      if (!(num > 0 && num < 2_000_000)) continue;
      return { value: num, unit: unitFromText(m[2]) ?? unitFromText(after.match(/^\s*\S+/)?.[0]) };
    }
  }
  return null;
}
