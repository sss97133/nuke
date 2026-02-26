import { normalizeListingLocation } from "./normalizeListingLocation.ts";

export interface ParsedLocation {
  raw: string | null;
  clean: string | null;
  city: string | null;
  state: string | null; // 2-letter abbreviation
  zip: string | null;
  confidence: number | null;
}

const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

const STATE_NAME_TO_ABBREV: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

// Known city→state corrections for common miscodings (abbreviation collision: AR=Arkansas vs AZ=Arizona, NE=Nebraska vs NV=Nevada)
const CITY_STATE_OVERRIDES: Record<string, string> = {
  'phoenix': 'AZ', 'tucson': 'AZ', 'scottsdale': 'AZ', 'mesa': 'AZ', 'tempe': 'AZ',
  'chandler': 'AZ', 'glendale': 'AZ', 'gilbert': 'AZ', 'peoria': 'AZ',
  'surprise': 'AZ', 'yuma': 'AZ', 'flagstaff': 'AZ', 'sedona': 'AZ',
  'las vegas': 'NV', 'henderson': 'NV', 'reno': 'NV', 'north las vegas': 'NV',
  'sparks': 'NV', 'carson city': 'NV', 'boulder city': 'NV',
};

/**
 * Parse a raw location string into structured city/state/zip components.
 * Wraps normalizeListingLocation() for sanitization, then extracts structure.
 *
 * normalizeListingLocation() rejects strings containing digits (to block JS/code garbage),
 * so we extract the zip code first, strip it, normalize the text portion, then reattach.
 */
export function parseLocation(raw: any): ParsedLocation {
  const rawStr = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  const trimmed = rawStr.trim();
  if (!trimmed) return { raw: null, clean: null, city: null, state: null, zip: null, confidence: null };

  // Pre-extract zip code (5-digit, optional +4) before passing to normalizeListingLocation
  const zipMatch = trimmed.match(/\b(\d{5}(?:-\d{4})?)\b/);
  const extractedZip = zipMatch?.[1] || null;

  // Strip the zip to let normalizeListingLocation pass
  const withoutZip = extractedZip ? trimmed.replace(extractedZip, "").replace(/\s{2,}/g, " ").trim() : trimmed;

  const normalized = normalizeListingLocation(withoutZip);

  if (!normalized.clean) {
    // normalizeListingLocation rejected it — try basic salvage for "City, ST" patterns
    const parts = withoutZip.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      const city = parts[0];
      const statePart = parts[1].replace(/[^A-Za-z]/g, "").toUpperCase();
      if (city.length >= 2 && VALID_STATES.has(statePart)) {
        return {
          raw: trimmed,
          clean: `${city}, ${statePart}`,
          city,
          state: statePart,
          zip: extractedZip,
          confidence: extractedZip ? 0.9 : 0.8,
        };
      }
    }
    return { raw: trimmed, clean: null, city: null, state: null, zip: null, confidence: null };
  }

  const s = normalized.clean;

  // Try: "City, ST 12345" or "City, ST"
  // Split on first comma only
  const commaIdx = s.indexOf(',');
  if (commaIdx > 0) {
    const city = s.slice(0, commaIdx).trim();
    const rest = s.slice(commaIdx + 1).trim();

    // Check for country suffix after state — e.g. "City, ST, USA" or "City, State, United States"
    // Split rest further
    const restParts = rest.split(',').map(p => p.trim());
    const stateRaw = restParts[0];

    // Parse state from first part of rest: "CA" or "California" (zip already stripped)
    const stateMatch = stateRaw.match(/^([A-Za-z][A-Za-z.\s]{0,20}?)$/);
    if (stateMatch) {
      const statePart = stateMatch[1].trim().replace(/\.$/, '');

      // Resolve state abbrev
      let stateAbbrev: string | null = null;
      const stateUpper = statePart.toUpperCase();
      if (VALID_STATES.has(stateUpper)) {
        stateAbbrev = stateUpper;
      } else {
        stateAbbrev = STATE_NAME_TO_ABBREV[statePart.toLowerCase()] || null;
      }

      // Apply known city override (handles AZ/AR and NV/NE collisions)
      const cityLower = city.toLowerCase();
      if (CITY_STATE_OVERRIDES[cityLower]) {
        stateAbbrev = CITY_STATE_OVERRIDES[cityLower];
      }

      const zip = extractedZip;

      if (stateAbbrev && city.length >= 2) {
        const cleanStr = zip ? `${city}, ${stateAbbrev} ${zip}` : `${city}, ${stateAbbrev}`;
        return {
          raw: trimmed,
          clean: cleanStr,
          city,
          state: stateAbbrev,
          zip,
          confidence: zip ? 0.9 : 0.8,
        };
      }

      // State didn't resolve but we have a city
      if (city.length >= 2) {
        return {
          raw: trimmed,
          clean: `${city}, ${statePart}`,
          city,
          state: null,
          zip,
          confidence: 0.6,
        };
      }
    }
  }

  // No comma — might be just a city name or country
  return {
    raw: trimmed,
    clean: normalized.clean,
    city: null,
    state: null,
    zip: extractedZip,
    confidence: 0.5,
  };
}
