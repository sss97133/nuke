// Vehicle identity from a listing title: year, then the longest matching make, then the model words.
// Shared by ingest and extract-facebook-marketplace, so a Facebook card and its ingest landing read one identity.
import { normalizeMake, isGarbageMake, isIdentityConjunction, hasMultipleModelYears } from "../_shared/normalizeVehicle.ts";

// Title-parsing make list — includes common aliases for matching.
// normalizeMake() from normalizeVehicle.ts handles canonical form conversion.
const MAKES = [
  "Toyota", "Ford", "Chevrolet", "Chevy", "Honda", "Nissan", "BMW",
  "Mercedes-Benz", "Mercedes", "Audi", "Porsche", "Volkswagen", "VW",
  "Dodge", "Ram", "Jeep", "GMC", "Cadillac", "Lincoln", "Buick",
  "Pontiac", "Oldsmobile", "Plymouth", "Chrysler", "Mazda", "Subaru",
  "Lexus", "Acura", "Infiniti", "Hyundai", "Kia", "Volvo", "Jaguar",
  "Land Rover", "Mini", "AMC", "International", "Studebaker", "Datsun",
  "Triumph", "MG", "Austin-Healey", "Shelby", "Saab", "Peugeot",
  "Fiat", "Alfa Romeo", "Ferrari", "Lamborghini", "Maserati", "Lotus",
  "De Tomaso", "Jensen", "TVR", "Morgan", "Sunbeam", "Opel",
  "Willys", "Kaiser", "Nash", "Hudson", "Packard", "Lancia",
  "DeLorean", "Isuzu", "Mitsubishi", "Suzuki", "Eagle",
  "Aston Martin", "Rolls-Royce", "Bentley", "McLaren", "Bugatti",
  "Tesla", "Rivian", "Hummer", "International Harvester",
  "AM General",
];

/**
 * MAKES matched longest-first, with hyphen and space treated as equivalent.
 *
 * Two bugs this closes, both measured in live rows on 2026-07-26:
 *  - URL slugs arrive with hyphens already turned into spaces
 *    ("mercedes benz 350slc"), so a literal startsWith("Mercedes-Benz") misses
 *    and the shorter alias "Mercedes" matches instead — consuming half the make
 *    and leaving the rest at the head of the model. Result: make
 *    "Mercedes-Benz" + model "benz sl500". 20 distinct corrupted model strings
 *    in 24h.
 *  - Array order decided which make won, so "International" shadowed
 *    "International Harvester" the same way.
 * Sorting by length makes the more specific make always win regardless of where
 * anyone adds an entry, and `[-\s]*` also catches the run-together spelling
 * ("rollsroyce") that RM Sotheby's slugs use.
 */
const MAKE_MATCHERS: Array<{ make: string; re: RegExp }> = [...MAKES]
  .sort((a, b) => b.length - a.length)
  .map((make) => ({
    make,
    re: new RegExp(
      "^" + make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]+/g, "[-\\s]*") + "\\b",
      "i",
    ),
  }));

export interface ParsedVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
  /** Set to "listing_text" when the model was read from the post's own text (craigslistBlip.modelFromText). */
  modelSource?: string | null;
}

// Models/sub-brands that unambiguously identify a make when the title omits it.
// Improves title parsing for facebook-saved and other sources with informal titles.
const MODEL_IMPLIES_MAKE: Record<string, string> = {
  // Chevrolet
  "corvette": "Chevrolet", "camaro": "Chevrolet", "chevelle": "Chevrolet",
  "nova": "Chevrolet", "el camino": "Chevrolet", "impala": "Chevrolet",
  "bel air": "Chevrolet", "monte carlo": "Chevrolet", "blazer": "Chevrolet",
  "silverado": "Chevrolet", "suburban": "Chevrolet",
  "c10": "Chevrolet", "c-10": "Chevrolet", "c20": "Chevrolet", "c-20": "Chevrolet",
  "c30": "Chevrolet", "c-30": "Chevrolet", "k10": "Chevrolet", "k-10": "Chevrolet",
  "k20": "Chevrolet", "k-20": "Chevrolet", "k5": "Chevrolet",
  "square body": "Chevrolet", "squarebody": "Chevrolet",
  "stingray": "Chevrolet",
  // GMC
  "k15": "GMC", "k-15": "GMC",
  // Ford
  "mustang": "Ford", "bronco": "Ford", "thunderbird": "Ford",
  "f-100": "Ford", "f100": "Ford", "f-150": "Ford", "f150": "Ford",
  "f-250": "Ford", "f250": "Ford", "f-350": "Ford", "f350": "Ford",
  "fairlane": "Ford", "galaxie": "Ford", "falcon": "Ford",
  // Dodge / Plymouth
  "charger": "Dodge", "challenger": "Dodge", "coronet": "Dodge",
  "roadrunner": "Plymouth", "road runner": "Plymouth",
  "barracuda": "Plymouth", "'cuda": "Plymouth", "cuda": "Plymouth",
  "duster": "Plymouth", "satellite": "Plymouth", "gtx": "Plymouth",
  // Pontiac
  "firebird": "Pontiac", "trans am": "Pontiac", "gto": "Pontiac",
  // Mercury / Dodge / Plymouth / Jeep / AMC bare models
  "comet": "Mercury", "cougar": "Mercury",
  "dart": "Dodge",
  "valiant": "Plymouth",
  "gremlin": "AMC", "javelin": "AMC",
  "wrangler": "Jeep", "cj": "Jeep", "cj5": "Jeep", "cj7": "Jeep", "yj": "Jeep",
  // Misc
  "miata": "Mazda",
  "scout": "International Harvester",
  "moke": "MINI",
};

/**
 * Take the first few words after the make as the model.
 *
 * The old filter dropped EVERY purely-numeric word, which deleted real model
 * designations: Austin-Healey 3000 lost its model entirely and was then refused
 * by the minimum-viability gate; Land Rover Defender 90 became "defender";
 * Chevrolet 210, Ferrari 250, Datsun 510, BMW 2002 all the same. The filter was
 * aimed at listing ids and prices, so aim it there instead: ids are long (5+
 * digits — `cleanSlugTail` already trims the trailing one) and a repeat of the
 * year is noise, but a short number is part of the car's name.
 */
function modelFromWords(text: string, year: number | null): string | null {
  return text
    .split(/[\s·•|—,\-$]+/)
    .filter((w) =>
      w &&
      !/^\$/.test(w) &&
      // keep 1-4 digit designations, drop long opaque ids
      !(/^\d+$/.test(w) && w.length > 4) &&
      // drop a restated year ("1969 chevrolet 1969 camaro")
      !(year !== null && w === String(year))
    )
    .slice(0, 3)
    .join(" ")
    .trim() || null;
}

export function parseVehicleTitle(text: string): ParsedVehicle {
  if (!text) return { year: null, make: null, model: null };
  if (hasMultipleModelYears(text)) return { year: null, make: null, model: null };

  // Strip common prefixes
  const cleaned = text
    .replace(/^(SOLD|PENDING|NEW|REDUCED|PRICE DROP)[:\s!-]*/i, "")
    .trim();

  // Extract year
  const yearMatch = cleaned.match(/\b(19\d{2}|20[0-2]\d)\b/);
  if (!yearMatch) return { year: null, make: null, model: null };
  const year = parseInt(yearMatch[1]);

  // Get text after year
  const afterYear = cleaned.slice(cleaned.indexOf(yearMatch[0]) + yearMatch[0].length).trim();
  if (isIdentityConjunction(afterYear.split(/\s+/)[0])) return { year, make: null, model: null };
  const lower = afterYear.toLowerCase();

  for (const { make, re } of MAKE_MATCHERS) {
    const hit = afterYear.match(re);
    if (hit) {
      // Slice by what actually matched, not by the length of the MAKES entry —
      // the two differ whenever the separator differs ("mercedes benz" is 13
      // chars, "Mercedes-Benz" is 13 but "mercedesbenz" is 12).
      const afterMake = afterYear.slice(hit[0].length).trim();
      return { year, make: normalizeMake(make) || make, model: modelFromWords(afterMake, year) };
    }
  }

  // No explicit make found — check if a known model name implies the make
  for (const [keyword, impliedMake] of Object.entries(MODEL_IMPLIES_MAKE)) {
    const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower)) {
      // Extract model as the text starting from the keyword
      const modelStart = lower.indexOf(keyword.toLowerCase());
      const modelText = modelFromWords(afterYear.slice(modelStart), year) || keyword;
      return { year, make: impliedMake, model: modelText };
    }
  }

  // Tier 3 fallback: no known make/model matched. Take the first token that
  // could plausibly be a make — skip leading dimension/engine/spec tokens
  // ("5x8", "22r", "500cc", "115", a doubled year) that FB/CL titles lead with.
  // If nothing plausible remains, make is UNKNOWN (null) — never a garbage
  // token on a live listing. (Gate 5, 2026-07-08.)
  const words = afterYear.split(/\s+/).filter(Boolean);
  let mi = 0;
  while (mi < words.length && isGarbageMake(words[mi])) mi++;
  const candidate = words[mi] || null;
  if (isIdentityConjunction(candidate)) return { year, make: null, model: null };
  const make = candidate && !isGarbageMake(candidate) ? candidate : null;
  return {
    year,
    make,
    model: make ? words.slice(mi + 1, mi + 3).join(" ") || null : null,
  };
}
