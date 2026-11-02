import { retainedPowertrainValue } from "./retainedPowertrain.ts";
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

export const DESCRIPTION_POWERTRAIN_VERSION = "retained_description_powertrain_v1";
export const ENGINE_FAMILY_LABEL_VERSION = "retained_engine_family_label_v1";
export const DESCRIPTION_ENGINE_FAMILY_LABEL_VERSION = "retained_description_engine_family_label_v1";
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

export function retainedDescriptionCaptureQualified(source: Record<string, any>): boolean {
  const d = source.structured_data;
  const captured = observationClockMicroseconds(d?.source_captured_at);
  const observed = observationClockMicroseconds(source.observed_at);
  const recorded = observationClockMicroseconds(source.ingested_at);
  if (source.extraction_method !== "html_description_capture" ||
      d?.extractor !== "extract-bat-core" ||
      !(d.source_text_field === "extract-bat-core.extractDescription" ||
        (d.source_capture_basis === "protected_snapshot" &&
         d.source_text_field === "listing_page_snapshots.html:batParser.extractDescription" &&
         /^listing_page_snapshots:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(source.raw_source_ref ?? ""))) ||
      d.description_capture !== true || d.extractor_input_truncated !== false ||
      !["direct_fetch", "protected_snapshot"].includes(d.source_capture_basis) ||
      !/^[0-9a-f]{64}$/.test(d.source_capture_sha256 ?? "") ||
      d.observation_time_basis !== "source_capture" || d.source_event_time_status !== "unknown" ||
      typeof d.source_captured_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(d.source_captured_at) ||
      captured === null || observed === null || recorded === null || captured !== observed || captured > recorded) return false;
  return true;
}
export function retainedDescriptionWitness(source: Record<string, any>, key: string) {
  return retainedDescriptionCaptureQualified(source) ? descriptionPowertrainWitness(key, source.content_text) : null;
}

// This new property's admission grammar is narrower than the existing powertrain
// witness. A reference to a model/brochure or a question is not this subject's label.
const FAMILY_SUBJECT = /^(?:(?:This|The) (?:car|truck|vehicle|engine|motorcycle|bike|conversion) (?:is|was) powered by\b|It (?:is|was) powered by\b|Powered by\b|Power (?:is (?:(?:provided|supplied) by|from)|comes from)\b)/i;
const FAMILY_QUALIFIED = /\?|\b(?:alleged(?:ly)?|reported(?:ly)?|apparent(?:ly)?|possible|possibly|presumed|presumably|believed|said)\b/i;

/** Literal publisher family labels are not casting/serial-derived engine_code.
 * Curator discovery and the registry-gated retained selector share this witness. */
export function proposedDescriptionEngineFamilyLabelWitness(text: unknown): { source_value: string; value: string } | null {
  if (typeof text !== "string" || bytes(text) < 100 || bytes(text) > 32000 ||
      !descriptionPowertrainWitness("engine_configuration", text) ||
      !descriptionPowertrainWitness("engine_displacement_l", text)) return null;
  let witness: { source_value: string; value: string } | null = null;
  for (const raw of text.split(/(?<=[.!?])[ \t\r\n]+|[\r\n]+/)) {
    const sentence = raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
    if (!SUBJECT.test(sentence) || !POWER.test(sentence)) continue;
    const familySubject = sentence.match(FAMILY_SUBJECT);
    if (!familySubject || FAMILY_QUALIFIED.test(sentence)) return null;
    if (bytes(sentence) > 500 || QUALIFIED.test(sentence)) return null;
    const labels = [...sentence.matchAll(/\b\d+(?:\.\d+)?-lit(?:er|re)[ \t]+([A-Z0-9]+(?:-[A-Z0-9]+)?)[ \t]+(?:[Vv](?:2|3|4|5|6|8|10|12|16)|(?:inline|flat)-(?:two|three|four|five|six|eight|ten|twelve|sixteen))\b/g)]
      .map(match => match[1]);
    if (!labels.length) continue;
    const complement = sentence.slice(familySubject[0].length)
      .replace(/^[ \t]+(?:(?:a|an)[ \t]+)?(?:(?:turbocharged|supercharged|twin-turbocharged)[ \t]+)?/i, "");
    if (!/^\d+(?:\.\d+)?-lit(?:er|re)[ \t]+([A-Z0-9]+(?:-[A-Z0-9]+)?)[ \t]+(?:[Vv](?:2|3|4|5|6|8|10|12|16)|(?:inline|flat)-(?:two|three|four|five|six|eight|ten|twelve|sixteen))\b/.test(complement)) return null;
    if (labels.some(label => label.length > 20 || !/[A-Z]/.test(label) || !/[0-9]/.test(label) || /^\d+[Vv]$/.test(label)) ||
        new Set(labels).size !== 1 || (witness && witness.value !== labels[0])) return null;
    witness ??= { source_value: sentence, value: labels[0] };
  }
  return witness;
}

export function proposedRetainedEngineFamilyLabelWitness(source: Record<string, any>) {
  return retainedDescriptionCaptureQualified(source) ? proposedDescriptionEngineFamilyLabelWitness(source.content_text) : null;
}
