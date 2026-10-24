// Mileage from a Mecum lot page's markdown (subtitle line, then highlight bullets). These spots
// usually carry the odometer ("110 Miles, Sunroof"), so only obvious non-odometer uses are dropped
// via the shared check in _shared/odometerText.ts: "70 miles per hour", "50 miles per gallon".
import { isNonOdometerMention } from "../_shared/odometerText.ts";

export interface MecumMarkdownMileage {
  mileage: number;
  source: "subtitle" | "highlights";
}

const LINE_RES: Array<[RegExp, MecumMarkdownMileage["source"]]> = [
  [/^[^#\n-].*$/gm, "subtitle"],
  [/^- .*$/gm, "highlights"],
];
const MILES_RE = /(\d{1,3}(?:,\d{3})+|\d{1,7})\s*(?:actual\s+)?miles\b/gi;

export function mileageFromMecumMarkdown(markdown: string): MecumMarkdownMileage | null {
  for (const [lineRe, source] of LINE_RES) {
    for (const line of markdown.matchAll(lineRe)) {
      for (const m of line[0].matchAll(MILES_RE)) {
        if (isNonOdometerMention(line[0], m.index ?? 0, m[0].length)) continue;
        const miles = parseInt(m[1].replace(/,/g, ""), 10);
        if (miles > 0 && miles < 1_000_000) return { mileage: miles, source };
      }
    }
  }
  return null;
}
