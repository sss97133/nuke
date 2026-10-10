import { retainedPowertrainValue } from "./retainedPowertrain.ts";
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

export const DESCRIPTION_POWERTRAIN_VERSION = "retained_description_powertrain_v1";
const KEYS = ["engine_configuration", "engine_displacement_l", "transmission_type"];
const SUBJECT = /^(?:This\b|The (?:car|truck|motorcycle|bike|vehicle|engine|conversion)\b|It\b|Finished in\b|Powered by\b|Power (?:is (?:(?:provided|supplied) by|from)|comes from)\b)/i;
const POWER = /\bpowered by\b|(?:^|, | and )power (?:is (?:(?:provided|supplied) by|from)|comes from)\b/i;
const QUALIFIED = /\b(?:unknown|unspecified|not|no|without|or|would|could|might|may|should|planned|proposed|intend|originally|previously|formerly|removed|replaced|spare|uninstalled|other|another)\b|["“”]/i;
const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Verbatim assertion sentences only. Conflicting or qualified witnesses fail closed. */
export function descriptionPowertrainWitness(key: string, text: unknown): { source_value: string; value: string | number } | null {
  if (!KEYS.includes(key) || typeof text !== "string" || bytes(text) < 100 || bytes(text) > 32000) return null;
  let witness: { source_value: string; value: string | number } | null = null;
  for (const raw of text.split(/(?<=[.!?])[ \t\r\n]+|[\r\n]+/)) {
    const sentence = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
    if (!SUBJECT.test(sentence) || !POWER.test(sentence)) continue;
    if (bytes(sentence) > 500 || QUALIFIED.test(sentence)) return null;
    if (key === "transmission_type" && !/\b(?:manual|automatic|cvt|semi)[ \t]+(?:transmission|transaxle|gearbox)\b/i.test(sentence)) continue;
    const value = retainedPowertrainValue(key, sentence);
    if (value === null) {
      if ((key === "engine_configuration" && /\b(?:v|i|inline|flat)[- ]?(?:2|3|4|5|6|8|10|12|16|two|three|four|five|six|eight|ten|twelve|sixteen)\b/i.test(sentence)) ||
          (key === "engine_displacement_l" && /\d[ ,.-]*(?:liter|litre|l|cc|ci)\b/i.test(sentence)) ||
          key === "transmission_type") return null;
      continue;
    }
    if (witness && witness.value !== value) return null;
    witness ??= { source_value: sentence, value };
  }
  return witness;
}

export function retainedDescriptionWitness(source: Record<string, any>, key: string) {
  const d = source.structured_data;
  const captured = observationClockMicroseconds(d?.source_captured_at);
  const observed = observationClockMicroseconds(source.observed_at);
  const recorded = observationClockMicroseconds(source.ingested_at);
  if (source.extraction_method !== "html_description_capture" ||
      d?.extractor !== "extract-bat-core" || d.source_text_field !== "extract-bat-core.extractDescription" ||
      d.description_capture !== true || d.extractor_input_truncated !== false ||
      !["direct_fetch", "protected_snapshot"].includes(d.source_capture_basis) ||
      !/^[0-9a-f]{64}$/.test(d.source_capture_sha256 ?? "") ||
      d.observation_time_basis !== "source_capture" || d.source_event_time_status !== "unknown" ||
      typeof d.source_captured_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(d.source_captured_at) ||
      captured === null || observed === null || recorded === null || captured !== observed || captured > recorded) return null;
  return descriptionPowertrainWitness(key, source.content_text);
}
