/** Native description odometer testimony, never a claim of true accumulated mileage. */
export const RETAINED_ODOMETER_VERSION = "retained_description_odometer_v1";
const ASSERTION = /^The (?:(?:five|six|seven)-digit |digital |retrofitted digital )?odometer (?:now )?(?:shows|indicates|reads|displays)[ \t]+(~|approximately[ \t]+|about[ \t]+)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,3})?)(k)?[ \t]+(miles|kilometers|km)\b/i;
const QUALIFIED = /\b(?:or|would|could|might|may|should|planned|proposed|previously|formerly|hypothetical|example)\b/i;
const bytes = (text: string) => new TextEncoder().encode(text).length;
export interface OdometerWitness {
  source_value: string;
  value: number;
  source_reading_value: number;
  source_reading_unit: "miles" | "kilometers";
  reported_precision_miles: number;
  value_is_approximate: boolean;
  reading_role: "odometer_display";
  true_mileage_status: "unknown";
}
export function retainedOdometerWitness(text: unknown): OdometerWitness | null {
  if (typeof text !== "string" || bytes(text) < 100 || bytes(text) > 32000) return null;
  let witness: OdometerWitness | null = null;
  for (const raw of text.split(/(?<=[.!?])[ \t\r\n]+|[\r\n]+/)) {
    const sentence = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
    const match = sentence.match(ASSERTION);
    if (!match) continue;
    if (bytes(sentence) > 500 || QUALIFIED.test(sentence)) return null;
    const token = match[2].replaceAll(",", "");
    const decimals = token.includes(".") ? token.split(".")[1].length : 0;
    const denominator = 10 ** decimals;
    const numerator = Number(token.replace(".", "")) * (match[3] ? 1000 : 1);
    const source = numerator / denominator;
    const unit = match[4].toLowerCase() === "miles" ? "miles" : "kilometers";
    // The ratified target is an integer. Explicit km displays normalize to the
    // nearest mile; fractional mile displays are retained raw and omitted here.
    if (!Number.isSafeInteger(numerator) || source < 0 || source >= 10000000 ||
        (unit === "miles" && numerator % denominator !== 0)) return null;
    const converted = unit === "kilometers" ? source * 1000 / 1609.344 : source;
    const value = Math.round(converted);
    const precision = (match[3] ? 1000 : 1) / denominator;
    const next: OdometerWitness = {
      source_value: sentence, value, source_reading_value: source, source_reading_unit: unit,
      reported_precision_miles: unit === "kilometers" ? Math.round(Math.max(1, precision * 1000 / 1609.344) * 1e6) / 1e6 : precision,
      value_is_approximate: Boolean(match[1] || match[3] || unit === "kilometers"),
      reading_role: "odometer_display", true_mileage_status: "unknown",
    };
    if (witness && (witness.source_reading_value !== source || witness.source_reading_unit !== unit)) return null;
    witness ??= next;
  }
  return witness;
}
