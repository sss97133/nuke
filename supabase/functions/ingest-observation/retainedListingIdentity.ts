/** Retained extractor labels, never an identity resolution or vehicle mutation. */
export const RETAINED_IDENTITY_KEYS = ["year", "make", "model", "vin"];
export const RETAINED_IDENTITY_LABEL_VERSION = "retained_listing_identity_labels_v1";
export function retainedListingIdentityValue(key: string, value: unknown): string | number | null {
  if (!RETAINED_IDENTITY_KEYS.includes(key)) return null;
  if (key === "year") return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 1800 && value <= 2100 ? value : null;
  if (key === "vin") return typeof value === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(value) &&
    /[0-9]/.test(value) && !/^([A-Z0-9])\1+$/.test(value) ? value : null;
  if (typeof value !== "string" || value !== value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "") || [...value].length < 1 || [...value].length > 120 ||
      /[\x00-\x1f\x7f]/.test(value) || /^(?:unknown|unspecified|n\/a|none|null|tbd|unidentified|other)$/i.test(value)) return null;
  return value;
}
