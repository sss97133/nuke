/**
 * Pollution Detector — Reusable content quality guard for all extractors.
 *
 * Extracted from extract-bat-core's battle-tested pollution detection logic.
 * Prevents comment contamination, SEO chrome, HTML tags, and sentence fragments
 * from leaking into structured vehicle fields.
 *
 * Usage:
 *   import { cleanContent, isPollutedField, stripHtmlTags } from "../_shared/pollutionDetector.ts";
 *
 *   const cleaned = cleanContent(rawHtml, { maxBytes: 50_000, platform: 'mecum' });
 *   if (isPollutedField('transmission', extractedValue)) { ... }
 */

// ─── Platform-specific boilerplate patterns ────────────────────────────────

const BOILERPLATE_PATTERNS: Record<string, RegExp[]> = {
  bat: [
    /for sale on bat auctions/i,
    /\|\s*bring a trailer/i,
    /bringatrailer\.com/i,
    /sold for \$/i,
    /\(lot #/i,
    /auction preview/i,
  ],
  mecum: [
    /mecum auctions/i,
    /kissimmee\s+\d{4}/i,
    /lot [A-Z]\d+/i,
    /register to bid/i,
    /mecum\.com/i,
  ],
  "barrett-jackson": [
    /barrett-jackson/i,
    /barrettjackson\.com/i,
    /register to bid/i,
    /consignment/i,
  ],
  bonhams: [
    /bonhams\.com/i,
    /lot\s+\d+\s*$/i,
    /register to bid/i,
    /bonhams & butterfields/i,
    /bonhams cars/i,
  ],
  gooding: [
    /gooding & company/i,
    /goodingco\.com/i,
    /register to bid/i,
    /pebble beach/i,
  ],
  generic: [
    /click here/i,
    /subscribe now/i,
    /sign up/i,
    /cookie policy/i,
    /privacy policy/i,
    /terms of service/i,
    /all rights reserved/i,
    /©\s*\d{4}/i,
  ],
};

// ─── HTML stripping ────────────────────────────────────────────────────────

/** Strip HTML tags, decode common entities, normalize whitespace */
export function stripHtmlTags(input: string): string {
  if (!input) return "";
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Check if a string contains HTML tags */
export function containsHtml(input: string): boolean {
  if (!input) return false;
  // Match actual HTML tags (not just angle brackets in text like "V8 > V6")
  return /<\/?[a-z][\s\S]*?>/i.test(input);
}

// ─── Content slicing ───────────────────────────────────────────────────────

export interface CleanContentOptions {
  /** Max bytes of content to return (prevents comment contamination). Default: 50000 */
  maxBytes?: number;
  /** Platform for boilerplate stripping */
  platform?: string;
  /** CSS selector hint for where the main content starts (used as string search) */
  contentStartMarker?: string;
  /** CSS selector hint for where comments/noise starts (truncate here) */
  contentEndMarker?: string;
}

/**
 * Clean and slice HTML content to reduce pollution risk.
 * - Finds main content section
 * - Truncates before comments/forums
 * - Limits total size
 * - Returns cleaned text ready for extraction
 */
export function cleanContent(html: string, options?: CleanContentOptions): string {
  if (!html) return "";
  const maxBytes = options?.maxBytes ?? 50_000;

  let content = html;

  // Find main content start (skip nav/header boilerplate)
  if (options?.contentStartMarker) {
    const idx = content.indexOf(options.contentStartMarker);
    if (idx >= 0) content = content.slice(idx);
  }

  // Truncate at comment/noise sections
  if (options?.contentEndMarker) {
    const idx = content.indexOf(options.contentEndMarker);
    if (idx > 0) content = content.slice(0, idx);
  }

  // Also truncate at common comment section markers
  const commentMarkers = [
    'id="comments"',
    'class="comments',
    'id="comment-section"',
    'class="comment-section',
    'id="disqus',
    'class="disqus',
    "data-comments",
    'id="user-comments"',
    'class="forum-posts',
  ];
  for (const marker of commentMarkers) {
    const idx = content.indexOf(marker);
    if (idx > 500) { // Only truncate if marker is well into the page
      content = content.slice(0, idx);
      break;
    }
  }

  // Enforce size limit
  if (content.length > maxBytes) {
    content = content.slice(0, maxBytes);
  }

  return content;
}

// ─── Field-level pollution detection ───────────────────────────────────────

/** Word count of a string */
function wordCount(t: string): number {
  return String(t || "").trim().split(/\s+/).filter(Boolean).length;
}

/** Check if a value looks like an engine spec */
function looksLikeEngineSpec(t: string): boolean {
  const s = String(t || "");
  return (
    /\b\d+(?:\.\d+)?-?\s*Liter\b/i.test(s) ||
    /\b\d+(?:\.\d+)?\s*L\b/i.test(s) ||
    /\bV\d\b/i.test(s) ||
    /\b[0-9,]{3,5}\s*cc\b/i.test(s) ||
    /\b\d{2,3}\s*ci\b/i.test(s) ||
    /\bcubic\s+inch\b/i.test(s) ||
    /\bflat[-\s]?(?:four|six)\b/i.test(s) ||
    /\binline[-\s]?(?:three|four|five|six|\d)\b/i.test(s) ||
    /\bv-?twin\b/i.test(s) ||
    /\bturbo/i.test(s) ||
    /\bsupercharg/i.test(s)
  );
}

/** Check if a value looks like a transmission spec */
function looksLikeTransmissionSpec(t: string): boolean {
  const s = String(t || "");
  return (
    /\b(transmission|transaxle|gearbox)\b/i.test(s) ||
    /\b(manual|automatic)\b/i.test(s) ||
    /\b(cvt|dct)\b/i.test(s) ||
    /\bdual[-\s]?clutch\b/i.test(s) ||
    /\b(\d{1,2}-speed|four-speed|five-speed|six-speed|seven-speed|eight-speed|nine-speed|ten-speed)\b/i.test(s) ||
    /\b(th400|th350|4l60|4l80|zf|getrag|tiptronic|pdk|muncie|tremec|borg[-\s]?warner)\b/i.test(s)
  );
}

/**
 * Check if a structured field value is polluted (contains garbage/boilerplate/noise).
 * Returns true if the value should be rejected.
 */
export function isPollutedField(
  field: string,
  value: any,
  options?: { platform?: string },
): boolean {
  const t = String(value ?? "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();

  // Universal checks
  if (lower === "var" || lower === "cycles" || lower === "undefined" || lower === "null") return true;
  if (containsHtml(t)) return true;
  if (t.length > 200) return true; // No structured field should be this long

  // Platform boilerplate check
  const platform = options?.platform ?? "generic";
  const patterns = [
    ...(BOILERPLATE_PATTERNS[platform] ?? []),
    ...BOILERPLATE_PATTERNS.generic,
  ];
  for (const pat of patterns) {
    if (pat.test(t)) return true;
  }

  // Field-specific checks
  switch (field) {
    case "model":
      // Model should be short and specific
      if (t.length > 80) return true;
      if (t.includes("|")) return true;
      if (wordCount(t) > 10) return true;
      break;

    case "make":
      if (t.length > 40) return true;
      if (wordCount(t) > 4) return true;
      break;

    case "transmission":
      if (t.startsWith(",")) return true;
      if (/driving experien|is said to have|were removed sometime/i.test(lower)) return true;
      if (!looksLikeTransmissionSpec(t) && (wordCount(t) > 18 || t.length > 90)) return true;
      if (/[.!?]/.test(t) && t.length > 60 && !looksLikeTransmissionSpec(t)) return true;
      break;

    case "color":
    case "exterior_color":
    case "interior_color":
      if (t.length > 80) return true;
      if (/\b(during|aforementioned|refurbishment|powered by|details include|automatic|headlights)\b/i.test(lower)) return true;
      if (wordCount(t) > 8) return true;
      break;

    case "engine":
    case "engine_type":
    case "engine_size":
      if (lower === "cycles") return true;
      if (!looksLikeEngineSpec(t) && (wordCount(t) > 14 || t.length > 120)) return true;
      if (!looksLikeEngineSpec(t) && /(table|coffee|chair|furniture)/i.test(lower)) return true;
      break;

    case "drivetrain":
      if (t.length > 40) return true;
      if (wordCount(t) > 5) return true;
      break;

    case "body_style":
      if (t.length > 60) return true;
      if (wordCount(t) > 6) return true;
      break;

    case "mileage":
      // Mileage should be numeric
      if (typeof value === "string" && !/^[\d,. ]+\s*(miles?|mi|km|k)?$/i.test(t)) {
        if (wordCount(t) > 4) return true;
      }
      break;
  }

  return false;
}

/**
 * Clean a structured field value by stripping HTML and trimming.
 * Returns null if the cleaned value is empty or polluted.
 */
export function cleanFieldValue(
  field: string,
  value: any,
  options?: { platform?: string },
): string | null {
  if (value === null || value === undefined) return null;

  let cleaned = String(value).trim();

  // Strip HTML if present
  if (containsHtml(cleaned)) {
    cleaned = stripHtmlTags(cleaned);
  }

  // Trim again after stripping
  cleaned = cleaned.trim();
  if (!cleaned) return null;

  // Check for pollution
  if (isPollutedField(field, cleaned, options)) return null;

  return cleaned;
}

/**
 * Batch-clean all vehicle fields, returning only clean values.
 * Polluted values are set to null.
 */
export function cleanVehicleFields(
  data: Record<string, any>,
  options?: { platform?: string },
): Record<string, any> {
  const textFields = [
    "make", "model", "color", "exterior_color", "interior_color",
    "transmission", "drivetrain", "engine", "engine_type", "engine_size",
    "body_style", "listing_title",
  ];

  const result = { ...data };

  for (const field of textFields) {
    if (field in result && result[field] != null) {
      result[field] = cleanFieldValue(field, result[field], options);
    }
  }

  // Special handling for description: strip HTML but don't reject for length
  if (result.description && containsHtml(String(result.description))) {
    result.description = stripHtmlTags(String(result.description)).trim() || null;
  }

  return result;
}
