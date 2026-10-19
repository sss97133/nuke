/**
 * Deterministic Barrett-Jackson Vehicle Facet & Identity Extraction.
 *
 * Audits and normalizes Barrett-Jackson lot headlines (`title`), raw `model` / `style`
 * fields, URL slugs, and lot `description` prose into canonical:
 *   - `year`, `make`, `model`
 *   - `series_code`      -> populates `vehicles.series`
 *   - `trim_package`     -> populates `vehicles.trim`
 *   - `body_style_facet` -> populates `vehicles.body_style`
 *
 * Guardrail: Base `make` and `model` family are anchored strictly to structured
 * fields (`make`, `model`, `title`, `url`). Description prose is only consulted
 * for within-family `series_code`, `trim_package`, and `body_style_facet` tokens
 * (with donor powertrain/suspension phrases stripped), preventing cross-family
 * contamination (e.g. "Corvette LS3 engine" or "Mustang II front suspension" in
 * a C10 pickup description).
 */

export interface BJFacetInput {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  style?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
}

export interface BJFacetExtraction {
  year: number | null;
  make: string | null;
  model: string | null;
  series_code: string | null;
  trim_package: string | null;
  body_style_facet: string | null;
}

export interface BJHeadlineParsed {
  year: number | null;
  make: string | null;
  modelRest: string | null;
}

/** Multi-word makes ordered longest-first so headline parsing never splits on the first space. */
const MULTI_WORD_MAKES: ReadonlyArray< readonly [RegExp, string] > = [
  [/^INTERNATIONAL\s+HARVESTER\b/i, "International Harvester"],
  [/^AMERICAN\s+MOTORS\b/i, "AMC"],
  [/^MERCEDES[-\s]+BENZ\b/i, "Mercedes-Benz"],
  [/^MERCEDES[-\s]+AMG\b/i, "Mercedes-AMG"],
  [/^AUSTIN[-\s]+HEALEY\b/i, "Austin-Healey"],
  [/^ASTON\s+MARTIN\b/i, "Aston Martin"],
  [/^ALFA\s+ROMEO\b/i, "Alfa Romeo"],
  [/^ROLLS[-\s]+ROYCE\b/i, "Rolls-Royce"],
  [/^LAND\s+ROVER\b/i, "Land Rover"],
  [/^RANGE\s+ROVER\b/i, "Land Rover"],
  [/^DE\s*TOMASO\b/i, "De Tomaso"],
  [/^AM\s+GENERAL\b/i, "AM General"],
  [/^HARLEY[-\s]+DAVIDSON\b/i, "Harley-Davidson"],
];

const SINGLE_WORD_MAKE_ALIASES: Record<string, string> = {
  chevrolet: "Chevrolet",
  chevy: "Chevrolet",
  gmc: "GMC",
  ford: "Ford",
  shelby: "Shelby",
  dodge: "Dodge",
  plymouth: "Plymouth",
  chrysler: "Chrysler",
  ram: "RAM",
  pontiac: "Pontiac",
  oldsmobile: "Oldsmobile",
  buick: "Buick",
  cadillac: "Cadillac",
  amc: "AMC",
  jeep: "Jeep",
  willys: "Willys",
  international: "International Harvester",
  studebaker: "Studebaker",
  packard: "Packard",
  hudson: "Hudson",
  nash: "Nash",
  lincoln: "Lincoln",
  mercury: "Mercury",
  porsche: "Porsche",
  ferrari: "Ferrari",
  lamborghini: "Lamborghini",
  maserati: "Maserati",
  bmw: "BMW",
  mercedes: "Mercedes-Benz",
  audi: "Audi",
  volkswagen: "Volkswagen",
  vw: "Volkswagen",
  jaguar: "Jaguar",
  bentley: "Bentley",
  lotus: "Lotus",
  mclaren: "McLaren",
  triumph: "Triumph",
  mg: "MG",
  sunbeam: "Sunbeam",
  morgan: "Morgan",
  mini: "MINI",
  fiat: "FIAT",
  toyota: "Toyota",
  lexus: "Lexus",
  nissan: "Nissan",
  datsun: "Datsun",
  honda: "Honda",
  acura: "Acura",
  mazda: "Mazda",
  subaru: "Subaru",
  mitsubishi: "Mitsubishi",
  delorean: "DeLorean",
  detomaso: "De Tomaso",
  hummer: "Hummer",
};

function canonicalMakeWord(raw: string): string {
  const cleaned = raw.trim();
  const lower = cleaned.toLowerCase();
  if (SINGLE_WORD_MAKE_ALIASES[lower]) return SINGLE_WORD_MAKE_ALIASES[lower];
  return cleaned
    .split(/([\s-]+)/)
    .map((part) =>
      /^[\s-]+$/.test(part)
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join("");
}

/**
 * Parse a Barrett-Jackson lot headline (e.g. "1973 CHEVROLET K10 CUSTOM DELUXE PICKUP"
 * or "1965 ASTON MARTIN DB5 COUPE") into `{ year, make, modelRest }`.
 */
export function parseBarrettJacksonHeadline(
  rawTitle: string | null | undefined,
): BJHeadlineParsed {
  if (!rawTitle || typeof rawTitle !== "string") {
    return { year: null, make: null, modelRest: null };
  }

  let cleaned = rawTitle
    .replace(/^#+\s*/, "")
    .replace(/\s*[-|]\s*Barrett[-\s]*Jackson.*$/i, "")
    .replace(/\s*[-|]\s*Lot\s*#?\s*[\d.]+\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  const yearMatch = cleaned.match(/^(18[89]\d|19\d{2}|20[0-3]\d)\s+(.+)$/);
  if (!yearMatch) {
    return { year: null, make: null, modelRest: null };
  }

  const year = parseInt(yearMatch[1], 10);
  const afterYear = yearMatch[2].trim();

  for (const [pattern, canonicalMake] of MULTI_WORD_MAKES) {
    const m = afterYear.match(pattern);
    if (m) {
      let rest = afterYear.slice(m[0].length).trim();
      // Special case: "Range Rover" -> make "Land Rover", prepend "Range Rover" if rest doesn't start with it
      if (/^RANGE\s+ROVER\b/i.test(m[0]) && !/^RANGE\s+ROVER\b/i.test(rest)) {
        rest = `Range Rover ${rest}`.trim();
      }
      return {
        year,
        make: canonicalMake,
        modelRest: rest || null,
      };
    }
  }

  const firstSpace = afterYear.search(/\s/);
  if (firstSpace === -1) {
    return {
      year,
      make: canonicalMakeWord(afterYear),
      modelRest: null,
    };
  }

  const makeToken = afterYear.slice(0, firstSpace);
  const rest = afterYear.slice(firstSpace + 1).trim();
  return {
    year,
    make: canonicalMakeWord(makeToken),
    modelRest: rest || null,
  };
}

/**
 * Strip donor engine/suspension/drivetrain phrases from description text before
 * scanning for within-family facet tokens.
 */
function sanitizeDescriptionForFacets(description: string | null | undefined): string {
  if (!description || typeof description !== "string") return "";
  return description
    // Strip common restomod donor component callouts so they don't trigger unrelated facets
    .replace(/\bMUSTANG\s+II\s+(?:FRONT\s+)?(?:IFS|SUSPENSION|SUBFRAME|FRONT\s+END|RACK)\b/gi, " ")
    .replace(/\bCORVETTE\s+(?:LS\d|LT\d|VETTE|ENGINE|MOTOR|DRIVETRAIN|TRANS(?:MISSION)?|REAR\s+END|SUSPENSION|BRAKES|ZO?6\s+BRAKES)\b/gi, " ")
    .replace(/\bCAMARO\s+(?:SUBFRAME|CLIP|FRONT\s+END|REAR\s+END)\b/gi, " ")
    .replace(/\bFORD\s+9[-\s]?INCH\b/gi, " ")
    // Only inspect the first 1,600 chars of the description where the lot identity & package are stated
    .slice(0, 1600);
}

/** Garbage or placeholder model strings found on raw BJ docket payloads. */
function isPlaceholderModel(model: string | null | undefined): boolean {
  if (!model) return true;
  const t = model.trim().toLowerCase();
  return (
    t === "" ||
    t === "n/a" ||
    t === "na" ||
    t === "none" ||
    t === "other" ||
    t === "custom" ||
    t === "pickup" ||
    t === "truck" ||
    t === "car" ||
    t === "suv" ||
    t === "sedan" ||
    t === "coupe" ||
    t === "convertible" ||
    t === "roadster" ||
    t === "wagon" ||
    t === "hardtop" ||
    t === "fastback" ||
    t === "window" ||
    /^\d+[-\s]*speed$/i.test(t)
  );
}

function normalizeUrlSlugText(url: string | null | undefined): string {
  if (!url) return "";
  const m = url.match(/\/vehicle\/(\d{4})-([a-z0-9-]+?)(?:-\d{4,})?\/?$/i);
  if (!m) return "";
  return m[2].replace(/-/g, " ").toUpperCase();
}

/**
 * Resolve the clean canonical base model from headline + raw model + URL slug.
 */
function resolveCanonicalModel(
  make: string | null,
  rawModel: string | null,
  headlineRest: string | null,
  urlSlugText: string,
  year: number | null,
): string | null {
  const brand = (make ?? "").trim().toLowerCase();
  // Combine headlineRest, rawModel, and urlSlugText for family/model detection
  const combined = [headlineRest, rawModel, urlSlugText]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (!combined) return rawModel;

  // ── Chevrolet & GMC ───────────────────────────────────────────────────────
  if (brand === "chevrolet" || brand === "gmc") {
    if (/\bCORVETTE\b|\bSTING\s*RAY\b|\bSPLIT[-\s]?WINDOW\b/.test(combined)) {
      return "Corvette";
    }
    if (/\bCHEVELLE\b|\bMALIBU\s+SS\b|\bLAGUNA\s+S[-\s]?3\b/.test(combined)) {
      return "Chevelle";
    }
    if (/\bCAMARO\b|\bIROC[-\s]?Z\b|\bZ\/?28\b/.test(combined)) {
      return "Camaro";
    }
    if (/\bEL\s+CAMINO\b/.test(combined)) return "El Camino";
    if (/\bMONTE\s+CARLO\b/.test(combined)) return "Monte Carlo";
    if (/\bNOVA\b/.test(combined)) return "Nova";
    if (/\bCHEVY\s+II\b/.test(combined)) return "Chevy II";
    if (/\bIMPALA\b/.test(combined)) return "Impala";
    if (/\bBISCAYNE\b/.test(combined)) return "Biscayne";
    if (/\bBEL\s+AIR\b|\bNOMAD\b|\bTWO[-\s]?TEN\b|\bONE[-\s]?FIFTY\b/.test(combined) ||
        (year != null && year >= 1955 && year <= 1957 && /\b(?:210|150)\b/.test(combined))) {
      if (/\bNOMAD\b/.test(combined) && !/\bBEL\s+AIR\b/.test(combined)) return "Bel Air";
      if (/\bBEL\s+AIR\b/.test(combined)) return "Bel Air";
      if (/\b210\b|\bTWO[-\s]?TEN\b/.test(combined)) return "210";
      if (/\b150\b|\bONE[-\s]?FIFTY\b/.test(combined)) return "150";
      return "Bel Air";
    }
    if (/\bCORVAIR\b/.test(combined)) return "Corvair";
    if (/\bSYCLONE\b/.test(combined)) return "Syclone";
    if (/\bTYPHOON\b/.test(combined)) return "Typhoon";
    if (/\bCABALLERO\b/.test(combined)) return "Caballero";
    if (/\bSPRINT\b/.test(combined) && brand === "gmc") return "Sprint";

    // K5 Blazer / Jimmy / Suburban
    if (/\bSUBURBAN\b/.test(combined)) return "Suburban";
    if (/\bK\/?5\s+BLAZER\b|\bBLAZER\b/.test(combined)) {
      return /\bK\/?5\b/.test(combined) || (year != null && year >= 1969 && year <= 1991 && !/\bS[-\s]?10\b/.test(combined))
        ? "K5 Blazer"
        : "Blazer";
    }
    if (/\bJIMMY\b/.test(combined)) {
      return /\bK\/?5\b/.test(combined) || (year != null && year >= 1970 && year <= 1991 && !/\bS[-\s]?15\b/.test(combined))
        ? "K5 Jimmy"
        : "Jimmy";
    }

    // GM C/K / R/V / Advance Design / Task Force Truck Series
    if (/\bC[-\s]?10\b/.test(combined)) return "C10";
    if (/\bK[-\s]?10\b/.test(combined)) return "K10";
    if (/\bC[-\s]?20\b/.test(combined)) return "C20";
    if (/\bK[-\s]?20\b/.test(combined)) return "K20";
    if (/\bC[-\s]?30\b/.test(combined)) return "C30";
    if (/\bK[-\s]?30\b/.test(combined)) return "K30";
    if (/\bR[-\s]?10\b/.test(combined)) return "R10";
    if (/\bV[-\s]?10\b/.test(combined)) return "V10";
    if (/\bR[-\s]?20\b/.test(combined)) return "R20";
    if (/\bV[-\s]?20\b/.test(combined)) return "V20";
    if (/\bC[-\s]?1500\b|\bC[-\s]?15\b/.test(combined)) return "C1500";
    if (/\bK[-\s]?1500\b|\bK[-\s]?15\b/.test(combined)) return "K1500";
    if (/\bC[-\s]?2500\b|\bC[-\s]?25\b/.test(combined)) return "C2500";
    if (/\bK[-\s]?2500\b|\bK[-\s]?25\b/.test(combined)) return "K2500";
    if (/\bC[-\s]?3500\b|\bC[-\s]?35\b/.test(combined)) return "C3500";
    if (/\bK[-\s]?3500\b|\bK[-\s]?35\b/.test(combined)) return "K3500";
    if (/\b454\s+SS\b/.test(combined) && year != null && year >= 1990 && year <= 1993) return "C1500";
    if (/\bCAMEO\b/.test(combined)) return "Cameo";
    if (/\bAPACHE\b/.test(combined)) return "Apache";
    if (/\b3100\b/.test(combined)) return "3100";
    if (/\b3600\b/.test(combined)) return "3600";
    if (/\b3800\b/.test(combined)) return "3800";
    if (/\bS[-\s]?10\b/.test(combined)) return "S-10";
    if (/\bS[-\s]?15\b/.test(combined)) return "S-15";
    if (/\bSILVERADO\b/.test(combined) && year != null && year >= 1999) return "Silverado";
    if (/\bSIERRA\b/.test(combined) && brand === "gmc" && year != null && year >= 1999) return "Sierra";
  }

  // ── Ford & Shelby ─────────────────────────────────────────────────────────
  if (brand === "ford" || brand === "shelby") {
    if (/\bBRONCO\b/.test(combined)) return "Bronco";
    if (/\bMUSTANG\b|\bBOSS\s+(?:302|429|351)\b|\bMACH\s+1\b/.test(combined)) return "Mustang";
    if (/\bGT500(?:KR)?\b|\bGT350[RH]?\b/.test(combined)) {
      return brand === "shelby" ? (/\bGT500KR\b/.test(combined) ? "GT500KR" : /\bGT500\b/.test(combined) ? "GT500" : "GT350") : "Mustang";
    }
    if (/\bCOBRA\b/.test(combined) && brand === "shelby") return "Cobra";
    if (/\bTHUNDERBIRD\b|\bT[-\s]?BIRD\b/.test(combined)) return "Thunderbird";
    if (/\bGT40\b|\bGT[-\s]40\b/.test(combined)) return "GT40";
    if (/\bF[-\s]?100\b/.test(combined)) return "F-100";
    if (/\bF[-\s]?150\b/.test(combined)) return "F-150";
    if (/\bF[-\s]?250\b/.test(combined)) return "F-250";
    if (/\bF[-\s]?350\b/.test(combined)) return "F-350";
    if (/\bF[-\s]?1\b/.test(combined)) return "F-1";
    if (/\bF[-\s]?2\b/.test(combined)) return "F-2";
    if (/\bF[-\s]?3\b/.test(combined)) return "F-3";
    if (/\bTORINO\b/.test(combined)) return "Torino";
    if (/\bFAIRLANE\b/.test(combined)) return "Fairlane";
    if (/\bGALAXIE\b/.test(combined)) return "Galaxie 500";
    if (/\bRANCHERO\b/.test(combined)) return "Ranchero";
    if (/\bFALCON\b/.test(combined)) return "Falcon";
  }

  // ── Plymouth & Dodge (Mopar) ──────────────────────────────────────────────
  if (brand === "plymouth" || brand === "dodge") {
    if (/\bSUPERBIRD\b/.test(combined)) return "Superbird";
    if (/\bROAD\s*RUNNER\b/.test(combined)) return "Road Runner";
    if (/\bGTX\b/.test(combined)) return "GTX";
    if (/\bBARRACUDA\b|['\u2019]?CUDA\b/.test(combined)) return "Barracuda";
    if (/\bDUSTER\b/.test(combined)) return "Duster";
    if (/\bSATELLITE\b/.test(combined)) return "Satellite";
    if (/\bFURY\b/.test(combined)) return "Fury";
    if (/\bPROWLER\b/.test(combined)) return "Prowler";
    if (/\bCHARGER\b/.test(combined)) return "Charger";
    if (/\bCHALLENGER\b/.test(combined)) return "Challenger";
    if (/\bSUPER\s+BEE\b/.test(combined)) return "Super Bee";
    if (/\bCORONET\b/.test(combined)) return "Coronet";
    if (/\bDART\b/.test(combined)) return "Dart";
    if (/\bVIPER\b/.test(combined)) return "Viper";
    if (/\bPOWER\s+WAGON\b|\bWM[-\s]?300\b/.test(combined)) return "Power Wagon";
    if (/\bD[-\s]?100\b/.test(combined)) return "D100";
    if (/\bD[-\s]?150\b/.test(combined)) return "D150";
    if (/\bD[-\s]?200\b/.test(combined)) return "D200";
    if (/\bW[-\s]?100\b/.test(combined)) return "W100";
    if (/\bW[-\s]?150\b/.test(combined)) return "W150";
    if (/\bW[-\s]?200\b/.test(combined)) return "W200";
  }

  // ── Pontiac / Oldsmobile / Buick ──────────────────────────────────────────
  if (brand === "pontiac") {
    if (/\bGTO\b|\bTHE\s+JUDGE\b/.test(combined)) return "GTO";
    if (/\bFIREBIRD\b|\bTRANS\s+AM\b/.test(combined)) return "Firebird";
    if (/\bBONNEVILLE\b/.test(combined)) return "Bonneville";
    if (/\bCATALINA\b/.test(combined)) return "Catalina";
    if (/\bGRAND\s+PRIX\b/.test(combined)) return "Grand Prix";
    if (/\bTEMPEST\b|\bLE\s*MANS\b/.test(combined)) return "LeMans";
  }

  if (brand === "oldsmobile") {
    if (/\b442\b/.test(combined)) return "442";
    if (/\bCUTLASS\b/.test(combined)) return "Cutlass";
    if (/\bTORONADO\b/.test(combined)) return "Toronado";
  }

  if (brand === "buick") {
    if (/\bGSX\b/.test(combined)) return "GSX";
    if (/\bGRAND\s+NATIONAL\b|\bGNX\b|\bREGAL\b/.test(combined)) return "Regal";
    if (/\bSKYLARK\b|\bGRAN\s+SPORT\b/.test(combined)) return "Skylark";
    if (/\bRIVIERA\b/.test(combined)) return "Riviera";
  }

  if (!isPlaceholderModel(rawModel)) {
    return rawModel!.trim();
  }

  if (headlineRest) {
    // Strip trailing generic body/custom suffixes when falling back to headlineRest
    const stripped = headlineRest
      .replace(/\b(?:CUSTOM\s+)?(?:2[-\s]?DOOR\s+|4[-\s]?DOOR\s+)?(?:PICKUP|TRUCK|COUPE|CONVERTIBLE|SEDAN|HARDTOP|FASTBACK|ROADSTER|WAGON|SUV)\s*$/i, "")
      .replace(/\s+\bCUSTOM\b\s*$/i, "")
      .trim();
    return stripped || headlineRest;
  }

  return rawModel;
}

/**
 * Deterministically extract `series_code`, `trim_package`, and `body_style_facet`
 * (plus normalized `year`, `make`, `model`) from Barrett-Jackson lot inputs.
 */
export function extractBarrettJacksonVehicleFacets(
  input: BJFacetInput,
): BJFacetExtraction {
  const headline = parseBarrettJacksonHeadline(input.title);
  const urlSlugText = normalizeUrlSlugText(input.url);

  const year = input.year ?? headline.year ?? (() => {
    const m = input.url?.match(/\/vehicle\/(\d{4})-/i);
    return m ? parseInt(m[1], 10) : null;
  })();

  const rawMake =
    input.make && (!headline.make || headline.make.toLowerCase() === input.make.trim().toLowerCase())
      ? input.make
      : headline.make || input.make;
  const make = rawMake ? canonicalMakeWord(rawMake) : null;
  const brand = (make ?? "").toLowerCase();

  const model = resolveCanonicalModel(
    make,
    input.model ?? null,
    headline.modelRest,
    urlSlugText,
    year,
  );
  const fam = (model ?? "").toLowerCase();

  // Primary text: headline + raw model + style + URL slug (highest trust, never cross-contaminated)
  const primaryUpper = [input.title, input.model, input.style, urlSlugText]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  // Secondary text: sanitized opening description (used only for within-family facet enrichment)
  const descUpper = sanitizeDescriptionForFacets(input.description).toUpperCase();
  const fullUpper = `${primaryUpper} ${descUpper}`.trim();

  const isGmPickupOrSuv =
    (brand === "chevrolet" || brand === "gmc") &&
    (/^(?:c|k|r|v)\d{2,4}$|^3[168]00$|^apache$|^cameo$|^s-1[05]$|^silverado$|^sierra$|^syclone$|^typhoon$|^k5|^blazer$|^jimmy$|^suburban$|^pickup$|^truck$/i.test(fam) ||
      /\b(?:PICKUP|TRUCK|STEPSIDE|FLEETSIDE|SHORT\s*BED|LONG\s*BED|SUBURBAN|BLAZER|JIMMY|C10|K10|C20|K20|C30|K30|3100|APACHE|CAMEO)\b/.test(primaryUpper));

  const isFordPickup =
    brand === "ford" &&
    (/^f-\d+$|^pickup$|^truck$|^ranger$/i.test(fam) ||
      /\b(?:F-?100|F-?150|F-?250|F-?350|F-?1\b|PICKUP|STYLESIDE|FLARESIDE)\b/.test(primaryUpper));

  let series_code: string | null = null;
  let trim_package: string | null = null;
  let body_style_facet: string | null = null;

  // =========================================================================
  // 1. SERIES CODE EXTRACTION (`series_code` -> `vehicles.series`)
  // =========================================================================

  // ── A. Chevrolet / GMC Pickups, Blazers, Suburbans ────────────────────────
  if (isGmPickupOrSuv) {
    // Check primary headline first, then family-scoped description
    for (const src of [primaryUpper, descUpper]) {
      if (!src) continue;
      if (/\bC[-\s]?10\b/.test(src)) { series_code = "C10"; break; }
      if (/\bK[-\s]?10\b/.test(src)) { series_code = "K10"; break; }
      if (/\bC[-\s]?20\b/.test(src)) { series_code = "C20"; break; }
      if (/\bK[-\s]?20\b/.test(src)) { series_code = "K20"; break; }
      if (/\bC[-\s]?30\b/.test(src)) { series_code = "C30"; break; }
      if (/\bK[-\s]?30\b/.test(src)) { series_code = "K30"; break; }
      if (/\bR[-\s]?10\b/.test(src)) { series_code = "R10"; break; }
      if (/\bV[-\s]?10\b/.test(src)) { series_code = "V10"; break; }
      if (/\bR[-\s]?20\b/.test(src)) { series_code = "R20"; break; }
      if (/\bV[-\s]?20\b/.test(src)) { series_code = "V20"; break; }
      if (/\bK[-\s]?1500\b|\bK[-\s]?15\b/.test(src)) { series_code = "K1500"; break; }
      if (/\bC[-\s]?1500\b|\bC[-\s]?15\b/.test(src)) { series_code = "C1500"; break; }
      if (/\bK[-\s]?2500\b|\bK[-\s]?25\b/.test(src)) { series_code = "K2500"; break; }
      if (/\bC[-\s]?2500\b|\bC[-\s]?25\b/.test(src)) { series_code = "C2500"; break; }
      if (/\bK[-\s]?3500\b|\bK[-\s]?35\b/.test(src)) { series_code = "K3500"; break; }
      if (/\bC[-\s]?3500\b|\bC[-\s]?35\b/.test(src)) { series_code = "C3500"; break; }
      if (/\bCAMEO\b/.test(src)) { series_code = "Cameo"; break; }
      if (/\bAPACHE\b/.test(src)) { series_code = "Apache"; break; }
      if (/\b3100\b/.test(src)) { series_code = "3100"; break; }
      if (/\b3600\b/.test(src)) { series_code = "3600"; break; }
      if (/\b3800\b/.test(src)) { series_code = "3800"; break; }
      if (/\bK\/?5\b/.test(src) && (fam.includes("blazer") || fam.includes("jimmy"))) {
        series_code = "K5";
        break;
      }
      if (/\bS[-\s]?10\b/.test(src)) { series_code = "S-10"; break; }
      if (/\bS[-\s]?15\b/.test(src)) { series_code = "S-15"; break; }
      if (/\b454\s+SS\b/.test(src) && year != null && year >= 1990 && year <= 1993) {
        series_code = "C1500";
        break;
      }
    }
    if (!series_code && (fam === "k5 blazer" || fam === "k5 jimmy")) {
      series_code = "K5";
    }
  }

  // ── B. Chevrolet Chevelle ─────────────────────────────────────────────────
  if (!series_code && fam === "chevelle") {
    if (/\bCOPO\b|\bYENKO\b/.test(fullUpper)) {
      series_code = /\bYENKO\b/.test(fullUpper) ? "Yenko" : "COPO";
    } else if (/\bSS\s*454\b|\b454\s*SS\b|\bLS6\b|\bLS[-\s]?6\b|\bLS5\b/.test(fullUpper) ||
               (/\b(?:SS|SUPER\s+SPORT)\b/.test(primaryUpper) && /\b454\b/.test(fullUpper))) {
      series_code = "SS 454";
    } else if (/\bSS\s*396\b|\b396\s*SS\b|\bL78\b|\bL89\b|\bL34\b/.test(fullUpper) ||
               (/\b(?:SS|SUPER\s+SPORT)\b/.test(primaryUpper) && /\b396\b/.test(fullUpper))) {
      series_code = "SS 396";
    } else if (/\bMALIBU\s+SS\b|\bCHEVELLE\s+SS\b|\bSUPER\s+SPORT\b|\bSS\b/.test(primaryUpper)) {
      series_code = "Chevelle SS";
    } else if (/\bLAGUNA\s+S[-\s]?3\b|\bLAGUNA\b/.test(fullUpper)) {
      series_code = "Laguna S-3";
    } else if (/\bMALIBU\b/.test(fullUpper)) {
      series_code = "Malibu";
    } else if (/\b300\s+DELUXE\b/.test(fullUpper)) {
      series_code = "300 Deluxe";
    }
  }

  // ── C. Chevrolet Camaro ───────────────────────────────────────────────────
  if (!series_code && fam === "camaro") {
    if (/\bCOPO\b|\bYENKO\b|\bBALDWIN\b|\bZL[-\s]?1\b/.test(fullUpper)) {
      series_code = /\bZL[-\s]?1\b/.test(fullUpper) ? "ZL1" : /\bYENKO\b/.test(fullUpper) ? "Yenko" : "COPO";
    } else if (/\bZ\/?28\b/.test(fullUpper)) {
      series_code = "Z/28";
    } else if (/\bIROC[-\s]?Z\b/.test(fullUpper)) {
      series_code = "IROC-Z";
    } else if (/\bRS\/SS\b|\bSS\/RS\b/.test(fullUpper) ||
               (/\b(?:RS|RALLY\s+SPORT)\b/.test(primaryUpper) && /\b(?:SS|SUPER\s+SPORT)\b/.test(primaryUpper))) {
      series_code = "RS/SS";
    } else if (/\bSS\b|\bSUPER\s+SPORT\b/.test(primaryUpper)) {
      series_code = "Camaro SS";
    } else if (/\bRS\b|\bRALLY\s+SPORT\b/.test(primaryUpper)) {
      series_code = "Camaro RS";
    } else if (/\bBERLINETTA\b/.test(fullUpper)) {
      series_code = "Berlinetta";
    }
  }

  // ── D. Chevrolet Bel Air / Tri-Five ───────────────────────────────────────
  if (!series_code && (fam === "bel air" || fam === "210" || fam === "150")) {
    if (/\bNOMAD\b/.test(fullUpper)) series_code = "Nomad";
    else if (/\bBEL\s+AIR\b/.test(fullUpper)) series_code = "Bel Air";
    else if (/\b210\b|\bTWO[-\s]?TEN\b/.test(fullUpper)) series_code = "210";
    else if (/\b150\b|\bONE[-\s]?FIFTY\b/.test(fullUpper)) series_code = "150";
  }

  // ── E. Chevrolet Corvette ─────────────────────────────────────────────────
  if (!series_code && fam === "corvette") {
    if (/\bZR[-\s]?1\b/.test(fullUpper)) {
      series_code = "ZR1";
    } else if (/\bZ06\b/.test(fullUpper)) {
      series_code = "Z06";
    } else if (/\bGRAND\s+SPORT\b/.test(fullUpper)) {
      series_code = "Grand Sport";
    } else if (/\bL88\b/.test(fullUpper)) {
      series_code = "L88";
    } else if (/\b427\b/.test(primaryUpper) || (year != null && year >= 1966 && year <= 1969 && /\b427\b/.test(descUpper))) {
      series_code = "427";
    } else if (/\bFUEL\s+INJECTED\b|\bFUELIE\b/.test(fullUpper) && (year == null || year <= 1965)) {
      series_code = "Fuel Injected";
    } else if (/\bSTING\s*RAY\b/.test(fullUpper) || (year != null && year >= 1963 && year <= 1967)) {
      series_code = year != null && year >= 1963 && year <= 1967 ? "Sting Ray" : "Stingray";
    } else if (year != null && year >= 1968 && year <= 1976 && /\bSTINGRAY\b/.test(fullUpper)) {
      series_code = "Stingray";
    }
  }

  // ── F. Ford Bronco ────────────────────────────────────────────────────────
  if (!series_code && fam === "bronco") {
    if (/\bRAPTOR\b/.test(fullUpper)) {
      series_code = "Bronco Raptor";
    } else if (/\bSTROPPE\b|\bBAJA\b/.test(fullUpper)) {
      series_code = "Bill Stroppe Baja";
    } else if (/\bU13\b/.test(fullUpper) || (year != null && year >= 1966 && year <= 1968 && /\bROADSTER\b/.test(fullUpper))) {
      series_code = "U13 Roadster";
    } else if (/\bU14\b|\bHALF[-\s]?CAB\b/.test(fullUpper)) {
      series_code = "U14 Half-Cab";
    } else if (/\bU15\b/.test(fullUpper) || (year != null && year >= 1966 && year <= 1977)) {
      series_code = "U15 Wagon";
    } else if (/\bEDDIE\s+BAUER\b/.test(fullUpper)) {
      series_code = "Eddie Bauer";
    } else if (/\bXLT\b/.test(fullUpper)) {
      series_code = "Bronco XLT";
    }
  }

  // ── G. Ford Mustang / Shelby ──────────────────────────────────────────────
  if (!series_code && (fam === "mustang" || (brand === "shelby" && /^gt[35]/i.test(fam)))) {
    if (/\bGT500\s*KR\b/.test(fullUpper)) series_code = "Shelby GT500KR";
    else if (/\bSHELBY\s+GT500\b|\bGT500\b/.test(fullUpper)) series_code = "Shelby GT500";
    else if (/\bSHELBY\s+GT350R\b|\bGT350R\b/.test(fullUpper)) series_code = "Shelby GT350R";
    else if (/\bSHELBY\s+GT350\b|\bGT350\b/.test(fullUpper)) series_code = "Shelby GT350";
    else if (/\bBOSS\s+429\b/.test(fullUpper)) series_code = "Boss 429";
    else if (/\bBOSS\s+302\b/.test(fullUpper)) series_code = "Boss 302";
    else if (/\bBOSS\s+351\b/.test(fullUpper)) series_code = "Boss 351";
    else if (/\bMACH\s+1\b/.test(fullUpper)) series_code = "Mach 1";
    else if (/\bSVT\s+COBRA\s+R\b|\bCOBRA\s+R\b/.test(fullUpper)) series_code = "SVT Cobra R";
    else if (/\bSVT\s+COBRA\b|\bTERMINATOR\b/.test(fullUpper)) series_code = "SVT Cobra";
    else if (/\bBULLITT\b/.test(fullUpper)) series_code = "Bullitt";
    else if (/\bMUSTANG\s+GT\b|\bGT\s+(?:FASTBACK|COUPE|CONVERTIBLE|HARDTOP|CS)\b|\bGT\/CS\b|\bCALIFORNIA\s+SPECIAL\b/.test(fullUpper)) {
      series_code = "Mustang GT";
    }
  }

  // ── H. Ford F-Series ──────────────────────────────────────────────────────
  if (!series_code && isFordPickup) {
    if (/\bF[-\s]?100\b/.test(fullUpper)) series_code = "F-100";
    else if (/\bF[-\s]?150\b/.test(fullUpper)) series_code = "F-150";
    else if (/\bF[-\s]?250\b/.test(fullUpper)) series_code = "F-250";
    else if (/\bF[-\s]?350\b/.test(fullUpper)) series_code = "F-350";
    else if (/\bF[-\s]?1\b/.test(fullUpper)) series_code = "F-1";
    else if (/\bF[-\s]?2\b/.test(fullUpper)) series_code = "F-2";
    else if (/\bF[-\s]?3\b/.test(fullUpper)) series_code = "F-3";
  }

  // ── I. Plymouth & Dodge (Road Runner, Superbird, GTX, Barracuda/'Cuda, Charger, Challenger) ─
  if (!series_code && (brand === "plymouth" || brand === "dodge")) {
    if (fam === "superbird" || /\bSUPERBIRD\b/.test(primaryUpper)) {
      series_code = "Superbird";
    } else if (fam === "road runner" || /\bROAD\s*RUNNER\b/.test(primaryUpper)) {
      series_code = "Road Runner";
    } else if (fam === "gtx" || /\bGTX\b/.test(primaryUpper)) {
      series_code = "GTX";
    } else if (fam === "barracuda") {
      if (/\bHEMI\s+['\u2019]?CUDA\b|\b426\s+HEMI\b/.test(fullUpper) && (year == null || year >= 1970)) {
        series_code = "Hemi 'Cuda";
      } else if (/\bAAR\s+['\u2019]?CUDA\b|\b['\u2019]?CUDA\s+AAR\b|\bALL\s+AMERICAN\s+RACERS\b/.test(fullUpper)) {
        series_code = "AAR 'Cuda";
      } else if (/['\u2019]CUDA\b|\bCUDA\b/.test(primaryUpper) || (year != null && year >= 1969 && year <= 1974 && /\b(?:440|383|340)\b/.test(fullUpper))) {
        series_code = "'Cuda";
      } else if (/\bFORMULA\s+S\b/.test(fullUpper)) {
        series_code = "Formula S";
      } else {
        series_code = "Barracuda";
      }
    } else if (fam === "charger") {
      if (/\bCHARGER\s+DAYTONA\b|\bDAYTONA\b/.test(fullUpper)) series_code = "Charger Daytona";
      else if (/\bCHARGER\s+500\b/.test(fullUpper)) series_code = "Charger 500";
      else if (/\bR\/T\b/.test(fullUpper)) series_code = "Charger R/T";
    } else if (fam === "challenger") {
      if (/\bCHALLENGER\s+T\/A\b|\bT\/A\b/.test(fullUpper)) series_code = "Challenger T/A";
      else if (/\bR\/T\b/.test(fullUpper)) series_code = "Challenger R/T";
      else if (/\bDEMON\b/.test(fullUpper)) series_code = "SRT Demon";
      else if (/\bHELLCAT\b/.test(fullUpper)) series_code = "SRT Hellcat";
    } else if (fam === "super bee" || fam === "coronet") {
      if (/\bSUPER\s+BEE\b/.test(fullUpper)) series_code = "Super Bee";
      else if (/\bR\/T\b/.test(fullUpper)) series_code = "Coronet R/T";
    } else if (fam === "dart") {
      if (/\bGTS\b/.test(fullUpper)) series_code = "Dart GTS";
      else if (/\bSWINGER\b/.test(fullUpper)) series_code = "Dart Swinger";
    } else if (/\bWM[-\s]?300\b/.test(fullUpper)) {
      series_code = "WM300";
    } else if (/\bPOWER\s+WAGON\b/.test(fullUpper)) {
      series_code = "Power Wagon";
    } else if (/\bD[-\s]?100\b/.test(fullUpper)) {
      series_code = "D100";
    } else if (/\bD[-\s]?150\b/.test(fullUpper)) {
      series_code = "D150";
    } else if (/\bW[-\s]?100\b/.test(fullUpper)) {
      series_code = "W100";
    } else if (/\bW[-\s]?150\b/.test(fullUpper)) {
      series_code = "W150";
    }
  }

  // ── J. Pontiac GTO / Firebird ─────────────────────────────────────────────
  if (!series_code && brand === "pontiac") {
    if (/\bTHE\s+JUDGE\b|\bGTO\s+JUDGE\b/.test(fullUpper)) series_code = "GTO The Judge";
    else if (fam === "gto") series_code = "GTO";
    else if (/\bSD[-\s]?455\b|\bSUPER\s+DUTY\b/.test(fullUpper)) series_code = "Trans Am SD-455";
    else if (/\bTRANS\s+AM\b/.test(fullUpper)) series_code = "Firebird Trans Am";
    else if (/\bFORMULA\b/.test(fullUpper)) series_code = "Firebird Formula";
  }

  // =========================================================================
  // 2. TRIM PACKAGE EXTRACTION (`trim_package` -> `vehicles.trim`)
  // =========================================================================

  // ── A. GM Trucks & SUVs ───────────────────────────────────────────────────
  if (isGmPickupOrSuv) {
    if (/\bCHEYENNE\s+SUPER\b/.test(fullUpper)) trim_package = "Cheyenne Super";
    else if (/\bCUSTOM\s+DELUXE\b/.test(fullUpper)) trim_package = "Custom Deluxe";
    else if (/\bSILVERADO\b/.test(fullUpper)) trim_package = "Silverado";
    else if (/\bCHEYENNE\b/.test(fullUpper)) trim_package = "Cheyenne";
    else if (/\bSCOTTSDALE\b/.test(fullUpper)) trim_package = "Scottsdale";
    else if (/\bBIG\s+10\b/.test(fullUpper)) trim_package = "Big 10";
    else if (/\b454\s+SS\b/.test(fullUpper)) trim_package = "454 SS";
    else if (/\bINDY\s+PACE\b|\bPACE\s+TRUCK\b/.test(fullUpper)) trim_package = "Indy Pace Truck";
    else if (/\bCST\b|\bCUSTOM\s+SPORT\s+TRUCK\b/.test(fullUpper)) trim_package = "CST";
    else if (/\bSIERRA\s+CLASSIC\b/.test(fullUpper)) trim_package = "Sierra Classic";
    else if (/\bSIERRA\s+GRANDE\b/.test(fullUpper)) trim_package = "Sierra Grande";
    else if (/\bHIGH\s+SIERRA\b/.test(fullUpper)) trim_package = "High Sierra";
    else if (/\bGENTLEMAN\s+JIM\b/.test(fullUpper)) trim_package = "Gentleman Jim";
    else if (/\bSUPER\s+CUSTOM\b/.test(fullUpper)) trim_package = "Super Custom";
    else if (/\bSIERRA\b/.test(fullUpper)) trim_package = "Sierra";
    else if (/\bCAMEO\s+CARRIER\b|\bCAMEO\b/.test(fullUpper)) trim_package = "Cameo Carrier";
    else if (/\b5[-\s]?WINDOW\b|\bFIVE[-\s]?WINDOW\b/.test(fullUpper)) trim_package = "5-Window";
  }

  // ── B. Chevrolet Chevelle ─────────────────────────────────────────────────
  if (!trim_package && fam === "chevelle") {
    if (/\bYENKO\b/.test(fullUpper)) trim_package = "Yenko";
    else if (/\bCOPO\b/.test(fullUpper)) trim_package = "COPO";
    else if ((/\bSS\s*454\b|\b454\s*SS\b|\b454\b/.test(fullUpper)) && /\bLS[-\s]?6\b/.test(fullUpper)) {
      trim_package = "SS 454 LS6";
    } else if (/\bSS\s*454\b|\b454\s*SS\b/.test(fullUpper) ||
               (/\b(?:SS|SUPER\s+SPORT)\b/.test(primaryUpper) && /\b454\b/.test(fullUpper))) {
      trim_package = "SS 454";
    } else if ((/\bSS\s*396\b|\b396\s*SS\b|\b396\b/.test(fullUpper)) && /\bL78\b/.test(fullUpper)) {
      trim_package = "SS 396 L78";
    } else if (/\bSS\s*396\b|\b396\s*SS\b/.test(fullUpper) ||
               (/\b(?:SS|SUPER\s+SPORT)\b/.test(primaryUpper) && /\b396\b/.test(fullUpper))) {
      trim_package = "SS 396";
    } else if (/\bMALIBU\s+SS\b/.test(fullUpper)) {
      trim_package = "Malibu SS";
    } else if (/\bCHEVELLE\s+SS\b|\bSUPER\s+SPORT\b|\bSS\b/.test(primaryUpper)) {
      trim_package = "SS";
    } else if (/\bLAGUNA\s+S[-\s]?3\b|\bLAGUNA\b/.test(fullUpper)) {
      trim_package = "Laguna S-3";
    } else if (/\bMALIBU\b/.test(fullUpper)) {
      trim_package = "Malibu";
    } else if (/\b300\s+DELUXE\b/.test(fullUpper)) {
      trim_package = "300 Deluxe";
    }
  }

  // ── C. Chevrolet Camaro ───────────────────────────────────────────────────
  if (!trim_package && fam === "camaro") {
    if (/\bYENKO\b/.test(fullUpper)) trim_package = "Yenko";
    else if (/\bCOPO\b/.test(fullUpper)) trim_package = "COPO";
    else if (/\bZL[-\s]?1\b/.test(fullUpper)) trim_package = "ZL1";
    else if (/\bRS\/SS\b|\bSS\/RS\b/.test(fullUpper) && /\bZ\/?28\b/.test(fullUpper)) trim_package = "RS/Z28";
    else if (/\bZ\/?28\b/.test(fullUpper)) trim_package = "Z/28";
    else if (/\bIROC[-\s]?Z\b/.test(fullUpper)) trim_package = "IROC-Z";
    else if (/\bRS\/SS\b|\bSS\/RS\b/.test(fullUpper) ||
             (/\b(?:RS|RALLY\s+SPORT)\b/.test(primaryUpper) && /\b(?:SS|SUPER\s+SPORT)\b/.test(primaryUpper))) {
      trim_package = "RS/SS";
    } else if (/\bSS\b|\bSUPER\s+SPORT\b/.test(primaryUpper)) trim_package = "SS";
    else if (/\bRS\b|\bRALLY\s+SPORT\b/.test(primaryUpper)) trim_package = "RS";
    else if (/\bBERLINETTA\b/.test(fullUpper)) trim_package = "Berlinetta";
  }

  // ── D. Chevrolet Bel Air / Tri-Five ───────────────────────────────────────
  if (!trim_package && (fam === "bel air" || fam === "210" || fam === "150")) {
    if (/\bNOMAD\b/.test(fullUpper)) trim_package = "Nomad";
    else if (/\bBEL\s+AIR\b/.test(fullUpper)) trim_package = "Bel Air";
  }

  // ── E. Ford Bronco ────────────────────────────────────────────────────────
  if (!trim_package && fam === "bronco") {
    if (/\bSTROPPE\b|\bBAJA\b/.test(fullUpper)) trim_package = "Stroppe Baja";
    else if (/\bRANGER\b/.test(fullUpper)) trim_package = "Ranger";
    else if (/\bSPORT\b/.test(primaryUpper) || /\bBRONCO\s+SPORT\b|\bSPORT\s+PACKAGE\b/.test(descUpper)) {
      trim_package = "Sport";
    } else if (/\bEDDIE\s+BAUER\b/.test(fullUpper)) trim_package = "Eddie Bauer";
    else if (/\bXLT\b/.test(fullUpper)) trim_package = "XLT";
    else if (/\bRAPTOR\b/.test(fullUpper)) trim_package = "Raptor";
  }

  // ── F. Ford Mustang / Shelby ──────────────────────────────────────────────
  if (!trim_package && (fam === "mustang" || (brand === "shelby" && /^gt[35]/i.test(fam)))) {
    if (/\bGT500\s*KR\b/.test(fullUpper)) trim_package = "Shelby GT500KR";
    else if (/\bSHELBY\s+GT500\b|\bGT500\b/.test(fullUpper)) trim_package = "Shelby GT500";
    else if (/\bSHELBY\s+GT350R\b|\bGT350R\b/.test(fullUpper)) trim_package = "Shelby GT350R";
    else if (/\bSHELBY\s+GT350\b|\bGT350\b/.test(fullUpper)) trim_package = "Shelby GT350";
    else if (/\bBOSS\s+429\b/.test(fullUpper)) trim_package = "Boss 429";
    else if (/\bBOSS\s+302\b/.test(fullUpper)) trim_package = "Boss 302";
    else if (/\bBOSS\s+351\b/.test(fullUpper)) trim_package = "Boss 351";
    else if (/\bMACH\s+1\b/.test(fullUpper)) trim_package = "Mach 1";
    else if (/\bSVT\s+COBRA\s+R\b|\bCOBRA\s+R\b/.test(fullUpper)) trim_package = "SVT Cobra R";
    else if (/\bSVT\s+COBRA\b|\bTERMINATOR\b/.test(fullUpper)) trim_package = "SVT Cobra";
    else if (/\bBULLITT\b/.test(fullUpper)) trim_package = "Bullitt";
    else if (/\bGT\/CS\b|\bCALIFORNIA\s+SPECIAL\b/.test(fullUpper)) trim_package = "GT/CS";
    else if (/\bMUSTANG\s+GT\b|\bGT\s+(?:FASTBACK|COUPE|CONVERTIBLE|HARDTOP)\b/.test(fullUpper)) trim_package = "GT";
  }

  // ── G. Ford F-Series ──────────────────────────────────────────────────────
  if (!trim_package && isFordPickup) {
    if (/\bRANGER\s+XLT\b/.test(fullUpper)) trim_package = "Ranger XLT";
    else if (/\bRANGER\s+LARIAT\b|\bLARIAT\b/.test(fullUpper)) trim_package = "Lariat";
    else if (/\bRANGER\b/.test(fullUpper)) trim_package = "Ranger";
    else if (/\bXLT\b/.test(fullUpper)) trim_package = "XLT";
    else if (/\bEXPLORER\b/.test(fullUpper)) trim_package = "Explorer";
    else if (/\bSPORT\s+CUSTOM\b/.test(fullUpper)) trim_package = "Sport Custom";
    else if (/\bCUSTOM\s+CAB\b/.test(fullUpper)) trim_package = "Custom Cab";
    else if (/\bSVT\s+LIGHTNING\b|\bLIGHTNING\b/.test(fullUpper)) trim_package = "SVT Lightning";
    else if (/\bRAPTOR\b/.test(fullUpper)) trim_package = "Raptor";
  }

  // ── H. Chevrolet Corvette ─────────────────────────────────────────────────
  if (!trim_package && fam === "corvette") {
    if (/\bZ06\b/.test(fullUpper)) trim_package = "Z06";
    else if (/\bZR[-\s]?1\b/.test(fullUpper)) trim_package = "ZR1";
    else if (/\bGRAND\s+SPORT\b/.test(fullUpper)) trim_package = "Grand Sport";
    else if (/\bL88\b/.test(fullUpper)) trim_package = "L88";
    else if (/\b427\/435\b/.test(fullUpper)) trim_package = "427/435";
    else if (/\b427\/400\b/.test(fullUpper)) trim_package = "427/400";
    else if (/\b427\/390\b/.test(fullUpper)) trim_package = "427/390";
    else if (/\bLT[-\s]?1\b/.test(fullUpper) && year != null && year >= 1970 && year <= 1972) trim_package = "LT-1";
    else if (/\bFUEL\s+INJECTED\b|\bFUELIE\b/.test(fullUpper) && (year == null || year <= 1965)) {
      trim_package = "Fuel Injected";
    } else if (/\bSPLIT[-\s]?WINDOW\b/.test(fullUpper) || (year === 1963 && /\bCOUPE\b/.test(fullUpper))) {
      trim_package = "Split-Window";
    } else if (/\b427\b/.test(primaryUpper)) {
      trim_package = "427";
    } else if (/\bSTING\s*RAY\b/.test(fullUpper)) {
      trim_package = year != null && year >= 1963 && year <= 1967 ? "Sting Ray" : "Stingray";
    }
  }

  // ── I. Plymouth & Dodge (Road Runner, Superbird, GTX, Cuda, Charger, Challenger) ─
  if (!trim_package && (brand === "plymouth" || brand === "dodge")) {
    if (/\b426\s+HEMI\b|\bHEMI\s+['\u2019]?CUDA\b|\bHEMI\s+(?:ROAD\s*RUNNER|GTX|CHARGER|CHALLENGER|SUPERBIRD|SUPER\s+BEE|CORONET)\b/.test(fullUpper) ||
        (/\bHEMI\b/.test(primaryUpper) && /^(?:barracuda|road runner|gtx|superbird|charger|challenger|super bee|coronet)$/.test(fam))) {
      trim_package = "426 Hemi";
    } else if (/\b440\s+SIX\s+BARREL\b|\b440[-\s]6\b|\bSIX\s+BARREL\b/.test(fullUpper) && brand === "plymouth") {
      trim_package = "440 Six Barrel";
    } else if (/\b440\s+SIX\s+PACK\b|\b440[-\s]6\b|\bSIX\s+PACK\b/.test(fullUpper) && brand === "dodge") {
      trim_package = "440 Six Pack";
    } else if (/\bAAR\s+['\u2019]?CUDA\b|\b['\u2019]?CUDA\s+AAR\b|\bAAR\b/.test(fullUpper) && fam === "barracuda") {
      trim_package = "AAR";
    } else if (/\bCHALLENGER\s+T\/A\b|\bT\/A\b/.test(fullUpper) && fam === "challenger") {
      trim_package = "T/A";
    } else if (/\bR\/T\s+SE\b/.test(fullUpper)) {
      trim_package = "R/T SE";
    } else if (/\bR\/T\b|\bROAD\s*\/?\s*TRACK\b/.test(fullUpper)) {
      trim_package = "R/T";
    } else if (/\bFORMULA\s+S\b/.test(fullUpper)) {
      trim_package = "Formula S";
    } else if (/\b440\b/.test(fullUpper) && /^(?:gtx|road runner|superbird|barracuda|charger|challenger|super bee|coronet)$/.test(fam)) {
      trim_package = brand === "plymouth" ? "440 Super Commando" : "440 Magnum";
    } else if (/\b383\b/.test(fullUpper) && /^(?:road runner|barracuda|charger|challenger|super bee|coronet)$/.test(fam)) {
      trim_package = "383";
    } else if (/\b340\b/.test(fullUpper) && /^(?:barracuda|duster|dart|challenger)$/.test(fam)) {
      trim_package = "340";
    } else if (fam === "superbird") {
      trim_package = "Superbird";
    } else if (fam === "gtx") {
      trim_package = "GTX";
    } else if (fam === "road runner") {
      trim_package = "Road Runner";
    } else if (fam === "barracuda" && (/['\u2019]CUDA\b|\bCUDA\b/.test(fullUpper))) {
      trim_package = "'Cuda";
    } else if (/\bLIL['\u2019]?\s+RED\s+EXPRESS\b/.test(fullUpper)) {
      trim_package = "Lil' Red Express";
    } else if (/\bWARLOCK\b/.test(fullUpper)) {
      trim_package = "Warlock";
    }
  }

  // ── J. Pontiac ────────────────────────────────────────────────────────────
  if (!trim_package && brand === "pontiac") {
    if (/\bTHE\s+JUDGE\b|\bGTO\s+JUDGE\b/.test(fullUpper)) trim_package = "The Judge";
    else if (/\bSD[-\s]?455\b|\bSUPER\s+DUTY\b/.test(fullUpper)) trim_package = "SD-455";
    else if (/\bRAM\s+AIR\s+IV\b/.test(fullUpper)) trim_package = "Ram Air IV";
    else if (/\bRAM\s+AIR\s+III\b/.test(fullUpper)) trim_package = "Ram Air III";
    else if (/\bTRANS\s+AM\b/.test(fullUpper)) trim_package = "Trans Am";
    else if (/\bFORMULA\b/.test(fullUpper)) trim_package = "Formula";
  }

  // =========================================================================
  // 3. BODY STYLE FACET EXTRACTION (`body_style_facet` -> `vehicles.body_style`)
  // =========================================================================

  if (/\bSPLIT[-\s]?WINDOW\b/.test(fullUpper) || (fam === "corvette" && year === 1963 && /\bCOUPE\b/.test(fullUpper))) {
    body_style_facet = "Split-Window Coupe";
  } else if (/\bGULLWING\b/.test(fullUpper) || (brand.startsWith("mercedes") && /\b300\s*SL\b/.test(fullUpper) && /\bCOUPE\b/.test(fullUpper))) {
    body_style_facet = "Gullwing Coupe";
  } else if (isGmPickupOrSuv || isFordPickup || /\bPICKUP\b|\bTRUCK\b/.test(primaryUpper)) {
    // Truck / SUV specific bed and cab configurations first
    if (/\bSTEPSIDE\b|\bFENDERSIDE\b|\bTHRIFTMASTER\b/.test(fullUpper)) {
      body_style_facet = "Stepside";
    } else if (/\bFLARESIDE\b/.test(fullUpper)) {
      body_style_facet = "Flareside";
    } else if (/\bFLEETSIDE\b|\bWIDELINE\b|\bWIDESIDE\b/.test(fullUpper)) {
      body_style_facet = "Fleetside";
    } else if (/\bSTYLESIDE\b/.test(fullUpper)) {
      body_style_facet = "Styleside";
    } else if (/\bSWEPTLINE\b|\bUTILINE\b/.test(fullUpper)) {
      body_style_facet = "Sweptline";
    } else if (/\bSHORT\s*BED\b|\bSHORT\s*BOX\b|\bSHORTBED\b|\bSWB\b/.test(fullUpper)) {
      body_style_facet = "Short Bed";
    } else if (/\bLONG\s*BED\b|\bLONG\s*BOX\b|\bLONGBED\b|\bLWB\b/.test(fullUpper)) {
      body_style_facet = "Long Bed";
    } else if (/\bSUBURBAN\b|\bCARRYALL\b/.test(fullUpper)) {
      body_style_facet = "Suburban";
    } else if (/\bPANEL\b|\bSEDAN\s+DELIVERY\b/.test(fullUpper)) {
      body_style_facet = "Panel";
    } else if (/\bCREW\s+CAB\b|\b3\+3\b/.test(fullUpper)) {
      body_style_facet = "Crew Cab";
    } else if (/\bK5\b|\bBLAZER\b|\bJIMMY\b/.test(fullUpper)) {
      body_style_facet = /\bCONVERTIBLE\b|\bROADSTER\b/.test(fullUpper) ? "Convertible" : "SUV";
    } else {
      body_style_facet = "Pickup";
    }
  } else if (fam === "bronco") {
    if (/\bU13\b|\bROADSTER\b/.test(fullUpper)) {
      body_style_facet = "Roadster";
    } else if (/\bU14\b|\bHALF[-\s]?CAB\b/.test(fullUpper)) {
      body_style_facet = "Half-Cab";
    } else if (/\bU15\b|\bWAGON\b/.test(fullUpper) || (year != null && year >= 1966 && year <= 1977)) {
      body_style_facet = "Wagon";
    } else {
      body_style_facet = "SUV";
    }
  } else if (/\bFASTBACK\b|\bSPORTSROOF\b|\b2\+2\b/.test(fullUpper)) {
    body_style_facet = "Fastback";
  } else if (/\bCONVERTIBLE\b|\bCABRIOLET\b|\bDROPHEAD\b|\bVOLANTE\b|\bSPIDER\b|\bSPYDER\b/.test(fullUpper)) {
    body_style_facet = "Convertible";
  } else if (/\bROADSTER\b|\bSPEEDSTER\b/.test(fullUpper)) {
    body_style_facet = "Roadster";
  } else if (/\bTARGA\b/.test(fullUpper)) {
    body_style_facet = "Targa";
  } else if (/\bT[-\s]?TOPS?\b/.test(fullUpper)) {
    body_style_facet = "T-Top";
  } else if (/\b2[-\s]?DOOR\s+HARDTOP\b|\bSPORT\s+COUPE\b/.test(fullUpper)) {
    body_style_facet = "2-Door Hardtop";
  } else if (/\bHARDTOP\b/.test(fullUpper)) {
    body_style_facet = "Hardtop";
  } else if (/\bCOUPE\b|\bBERLINETTA\b|\bGTB\b|\bNOTCHBACK\b/.test(fullUpper)) {
    body_style_facet = "Coupe";
  } else if (/\bWAGON\b|\bNOMAD\b|\bESTATE\b|\bTOURING\b|\bSHOOTING\s+BRAKE\b/.test(fullUpper)) {
    body_style_facet = "Wagon";
  } else if (/\bSEDAN\b|\b4[-\s]?DOOR\b|\bSALOON\b/.test(fullUpper)) {
    body_style_facet = "Sedan";
  }

  return {
    year,
    make,
    model,
    series_code,
    trim_package,
    body_style_facet,
  };
}

/**
 * Mutates a parsed Barrett-Jackson vehicle object in-place to populate
 * `year`, `make`, `model`, `series_code`, `trim_package`, and `body_style_facet`.
 */
export function applyBarrettJacksonVehicleFacets<
  T extends {
    url?: string | null;
    title?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    style?: string | null;
    description?: string | null;
    series_code?: string | null;
    trim_package?: string | null;
    body_style_facet?: string | null;
  },
>(vehicle: T): T {
  const extracted = extractBarrettJacksonVehicleFacets({
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    style: vehicle.style,
    title: vehicle.title,
    description: vehicle.description,
    url: vehicle.url,
  });

  if (extracted.year != null && !vehicle.year) vehicle.year = extracted.year;
  if (extracted.make) vehicle.make = extracted.make;
  if (extracted.model) vehicle.model = extracted.model;
  vehicle.series_code = extracted.series_code;
  vehicle.trim_package = extracted.trim_package;
  vehicle.body_style_facet = extracted.body_style_facet;
  if (extracted.body_style_facet && (!vehicle.style || isPlaceholderModel(vehicle.style))) {
    vehicle.style = extracted.body_style_facet;
  }
  return vehicle;
}
