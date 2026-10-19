/** Deterministic projection of explicit retained text, never a factory/current assertion. */
export const RETAINED_POWERTRAIN_FIELDS = {
  engine_configuration: "engine_size",
  engine_displacement_l: "engine_size",
  transmission_type: "transmission",
  drivetrain_layout: "drivetrain",
} as const;
export function retainedPowertrainValue(key: string, raw: unknown): string | number | null {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 500 ||
      /\b(?:unknown|unspecified|not|no|without|or)\b/i.test(raw)) return null;
  const text = raw.trim();
  if (key === "drivetrain_layout") return /^(FWD|RWD|AWD|4WD)$/i.test(text) ? text.toUpperCase() : null;
  if (key === "transmission_type") {
    const matches = [...text.toLowerCase().matchAll(/\b(manual|automatic|cvt|semi)\b/g)].map(m => m[1]);
    const unique = [...new Set(matches)];
    return unique.length === 1 ? unique[0] : null;
  }
  if (key === "engine_displacement_l") {
    const matches = [...text.toLowerCase().matchAll(/(?<![-+.,\d])\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*-?\s*(liter|litre|l|cc|ci)\b/g)];
    if (matches.length !== 1) return null;
    const n = Number(matches[0][1].replaceAll(",", ""));
    const unit = matches[0][2];
    const liters = n * (unit === "cc" ? .001 : unit === "ci" ? .016387064 : 1);
    return liters > 0 && liters <= 30 ? Math.round(liters * 1e6) / 1e6 : null;
  }
  if (key === "engine_configuration") {
    const numbers: Record<string, string> = {two:"2",three:"3",four:"4",five:"5",six:"6",eight:"8",ten:"10",twelve:"12",sixteen:"16"};
    const matches = [...text.toLowerCase().matchAll(/\b(v|i|inline|flat)[-\s]?(2|3|4|5|6|8|10|12|16|two|three|four|five|six|eight|ten|twelve|sixteen)\b/g)];
    const values = [...new Set(matches.map(m => `${m[1] === "flat" ? "flat-" : m[1] === "v" ? "V" : "I"}${numbers[m[2]] ?? m[2]}`))];
    return values.length === 1 ? values[0] : null;
  }
  return null;
}
