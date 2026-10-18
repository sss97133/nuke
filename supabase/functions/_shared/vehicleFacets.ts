/**
 * Shared Deterministic Vehicle Facet Extraction
 *
 * Extracts structured `series`, `trim`, and `body_style` facets from collector
 * vehicle headlines, model names, URL slugs, and catalog blurbs across
 * Barrett-Jackson, Mecum, RM Sotheby's, and Bonhams.
 *
 * Designed as pure, zero-API-cost deterministic logic so collector sub-series
 * (e.g. C10 vs K10, 3100 vs Apache, U13 Roadster vs U14 Half-Cab, Shelby GT500
 * vs Boss 302, Superbird vs Hemi 'Cuda, Porsche 356A/911 Carrera RS 2.7,
 * Mercedes-Benz 300 SL Gullwing, Jaguar XK140 SE Drophead Coupé, Ferrari 250 GT
 * SWB Berlinetta) are preserved as queryable structured facets instead of being
 * collapsed into generic model strings or lost in raw titles.
 */

export interface VehicleFacetInput {
  year: number | null;
  make: string | null;
  model: string | null;
  title?: string | null;
  url?: string | null;
  description?: string | null;
  bodyStyleHint?: string | null;
  trimHint?: string | null;
  seriesHint?: string | null;
}

export interface VehicleFacets {
  /** Normalized base model family when a more specific sub-series was extracted */
  canonical_model: string | null;
  /** Sub-series / generation / chassis code (e.g. "C10", "K10", "3100", "U13 Roadster", "Boss 302", "300 SL", "XK140") */
  series_code: string | null;
  /** Trim or performance package (e.g. "Silverado", "Cheyenne", "SS 454", "Z/28", "Ranger", "R/T", "SE", "Gullwing") */
  trim_package: string | null;
  /** Specific collector body configuration (e.g. "Stepside Pickup", "Fleetside Pickup", "Split-Window Coupe", "Fastback", "Convertible") */
  body_style_facet: string | null;
  /** Drivetrain hint inferred from series code (e.g. "2WD" for C10/C20, "4WD" for K10/K20/K5/Power Wagon) */
  drivetrain_hint: "2WD" | "4WD" | null;
  /** Bed length when stated on pickups ("Short Bed" | "Long Bed") */
  bed_length: "Short Bed" | "Long Bed" | null;
  /** Cab configuration on trucks ("Regular Cab" | "Crew Cab" | "Extended Cab" | "Half-Cab") */
  cab_style: string | null;
  /** Restomod / custom build classification ("Restomod" | "Custom" | "Hot Rod" | "Stock/Original") */
  build_kind: "Restomod" | "Custom" | "Hot Rod" | null;
}

export type BarrettJacksonFacetInput = VehicleFacetInput;
export type BarrettJacksonVehicleFacets = VehicleFacets;

export interface ParsedHeadlineVehicle {
  year: number | null;
  make: string | null;
  model: string | null;
  facets: VehicleFacets;
}

/**
 * Multi-word makes in longest-first order so "American Motors" matches before "American",
 * "Mercedes-Benz" before "Mercedes", etc.
 */
const MULTI_WORD_MAKES: Array<[RegExp, string]> = [
  [/^american\s+motors\b/i, "AMC"],
  [/^american\s+lafrance\b/i, "American LaFrance"],
  [/^alfa\s+romeo\b/i, "Alfa Romeo"],
  [/^aston\s+martin\b/i, "Aston Martin"],
  [/^austin[-\s]+healey\b/i, "Austin-Healey"],
  [/^avanti\s+motors\b/i, "Avanti"],
  [/^de\s+tomaso\b/i, "De Tomaso"],
  [/^delahaye\b/i, "Delahaye"],
  [/^delaunay[-\s]+belleville\b/i, "Delaunay-Belleville"],
  [/^de\s+soto\b/i, "DeSoto"],
  [/^duesenberg\b/i, "Duesenberg"],
  [/^factory\s+five\b/i, "Factory Five"],
  [/^hispano[-\s]+suiza\b/i, "Hispano-Suiza"],
  [/^international\s+harvester\b/i, "International"],
  [/^isotta\s+fraschini\b/i, "Isotta Fraschini"],
  [/^land\s+rover\b/i, "Land Rover"],
  [/^mercedes[-\s]+benz\b/i, "Mercedes-Benz"],
  [/^mercedes[-\s]+amg\b/i, "Mercedes-Benz"],
  [/^morgan\b/i, "Morgan"],
  [/^pierce[-\s]+arrow\b/i, "Pierce-Arrow"],
  [/^rolls[-\s]+royce\b/i, "Rolls-Royce"],
  [/^shelby\s+american\b/i, "Shelby"],
  [/^studebaker\b/i, "Studebaker"],
  [/^stutz\b/i, "Stutz"],
  [/^superformance\b/i, "Superformance"],
  [/^talbot[-\s]+lago\b/i, "Talbot-Lago"],
];

const SINGLE_TOKEN_MAKE_CANONICAL: Record<string, string> = {
  ac: "AC",
  acura: "Acura",
  allard: "Allard",
  alpine: "Alpine",
  alvis: "Alvis",
  amc: "AMC",
  amphicar: "Amphicar",
  ariel: "Ariel",
  arnolt: "Arnolt",
  auburn: "Auburn",
  audi: "Audi",
  austin: "Austin",
  autobianchi: "Autobianchi",
  avanti: "Avanti",
  bentley: "Bentley",
  Backdraft: "Backdraft",
  backdraft: "Backdraft",
  bizzarrini: "Bizzarrini",
  bmw: "BMW",
  bricklin: "Bricklin",
  bristol: "Bristol",
  bugatti: "Bugatti",
  buick: "Buick",
  cadillac: "Cadillac",
   Caterham: "Caterham",
  caterham: "Caterham",
  checker: "Checker",
  chevrolet: "Chevrolet",
  chevy: "Chevrolet",
  chrysler: "Chrysler",
  cisitalia: "Cisitalia",
  citroen: "Citroën",
  "citroën": "Citroën",
  cord: "Cord",
  crosley: "Crosley",
  cunningham: "Cunningham",
  daimler: "Daimler",
  datsun: "Datsun",
  delage: "Delage",
  delorean: "DeLorean",
  desoto: "DeSoto",
  detomaso: "De Tomaso",
  divco: "Divco",
  dkw: "DKW",
  dodge: "Dodge",
  ducati: "Ducati",
  edsel: "Edsel",
  excalibur: "Excalibur",
  facel: "Facel Vega",
  ferrari: "Ferrari",
  fiat: "Fiat",
  fisker: "Fisker",
  ford: "Ford",
  frazer: "Frazer",
  geo: "Geo",
  gmc: "GMC",
  griffith: "Griffith",
  heinkel: "Heinkel",
  hennessey: "Hennessey",
  hillman: "Hillman",
  honda: "Honda",
  horch: "Horch",
  hudson: "Hudson",
  hummer: "Hummer",
  hupmobile: "Hupmobile",
  imperial: "Imperial",
  indian: "Indian",
  infiniti: "Infiniti",
  innocenti: "Innocenti",
  international: "International",
  iso: "Iso",
  isuzu: "Isuzu",
  jaguar: "Jaguar",
  jeep: "Jeep",
  jensen: "Jensen",
  kaiser: "Kaiser",
  karma: "Karma",
  kia: "Kia",
  koenigsegg: "Koenigsegg",
  lagonda: "Lagonda",
  lamborghini: "Lamborghini",
  lancia: "Lancia",
  lexus: "Lexus",
  lincoln: "Lincoln",
  locomobile: "Locomobile",
  lola: "Lola",
  lotus: "Lotus",
  lucid: "Lucid",
  marmon: "Marmon",
  maserati: "Maserati",
  matra: "Matra",
  maybach: "Maybach",
  mazda: "Mazda",
  mclaren: "McLaren",
  mercedes: "Mercedes-Benz",
  mercury: "Mercury",
  merkur: "Merkur",
  messerschmitt: "Messerschmitt",
  mg: "MG",
  mini: "Mini",
  mitsubishi: "Mitsubishi",
  monteverdi: "Monteverdi",
  morris: "Morris",
  nash: "Nash",
  nissan: "Nissan",
  noble: "Noble",
  nsu: "NSU",
  oakland: "Oakland",
  oldsmobile: "Oldsmobile",
  opel: "Opel",
  osca: "OSCA",
  packard: "Packard",
  pagani: "Pagani",
  panoz: "Panoz",
  peel: "Peel",
  peugeot: "Peugeot",
  pininfarina: "Pininfarina",
  plymouth: "Plymouth",
  polestar: "Polestar",
  pontiac: "Pontiac",
  porsche: "Porsche",
  ram: "Ram",
  rambler: "Rambler",
  renault: "Renault",
  reo: "REO",
  riley: "Riley",
  rivian: "Rivian",
  rov: "Rover",
  rover: "Rover",
  ruf: "RUF",
  saab: "Saab",
  saleen: "Saleen",
  saturn: "Saturn",
  scion: "Scion",
  shelby: "Shelby",
  siata: "Siata",
  simca: "Simca",
  singer: "Singer",
  smart: "Smart",
  spyker: "Spyker",
  ssc: "SSC",
  subaru: "Subaru",
  sunbeam: "Sunbeam",
  suzuki: "Suzuki",
  tatra: "Tatra",
  tesla: "Tesla",
  toyota: "Toyota",
  trabant: "Trabant",
  triumph: "Triumph",
  tucker: "Tucker",
  tvr: "TVR",
  vauxhall: "Vauxhall",
  vespa: "Vespa",
  volkswagen: "Volkswagen",
  vw: "Volkswagen",
  volvo: "Volvo",
  wanderer: "Wanderer",
  willys: "Willys",
  zimmer: "Zimmer",
};

/**
 * Strips URL slug tokens into a readable space-separated string when a Barrett-Jackson
 * lot URL is available (e.g. `.../1972-chevrolet-k10-custom-sport-truck-pickup-292116` ->
 * `1972 chevrolet k10 custom sport truck pickup`).
 */
export function extractSlugTextFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";
    return last
      .replace(/-\d{4,}$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
  } catch {
    const parts = url.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    return last
      .replace(/-\d{4,}$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
  }
}

/**
 * Normalizes a make token using known collector car brands.
 */
function canonicalizeMakeToken(rawMake: string | null | undefined): string | null {
  if (!rawMake) return null;
  const cleaned = rawMake.trim();
  if (!cleaned) return null;
  for (const [re, canonical] of MULTI_WORD_MAKES) {
    if (re.test(cleaned)) return canonical;
  }
  const key = cleaned.toLowerCase();
  return SINGLE_TOKEN_MAKE_CANONICAL[key] || cleaned;
}

/**
 * Parses a Barrett-Jackson headline or URL slug into `{ year, make, model, facets }`.
 * Handles multi-word makes ("Mercedes-Benz", "Aston Martin", "Austin-Healey", "Land Rover",
 * "Alfa Romeo", "De Tomaso", "Rolls-Royce", "American Motors") and extracts structured
 * series/trim/body_style facets.
 */
export function parseBarrettJacksonHeadline(
  title: string | null | undefined,
  url?: string | null,
): ParsedHeadlineVehicle {
  const rawTitle = (title || "").replace(/\s+/g, " ").trim();
  const slugText = extractSlugTextFromUrl(url);
  const source = rawTitle || slugText;

  let year: number | null = null;
  let rest = source;

  // Strip leading lot prefixes if any ("Lot #1234 - 1969 Chevrolet Camaro...")
  rest = rest.replace(/^(?:lot\s*#?\s*[\d.]+\s*[-:–—]\s*)/i, "").trim();

  const yearMatch = rest.match(/^(\d{4})\b\s*(.*)$/);
  if (yearMatch) {
    const parsedYear = parseInt(yearMatch[1], 10);
    if (parsedYear >= 1886 && parsedYear <= 2035) {
      year = parsedYear;
      rest = yearMatch[2].trim();
    }
  }

  let make: string | null = null;
  let modelRemainder = rest;

  for (const [re, canonical] of MULTI_WORD_MAKES) {
    const m = modelRemainder.match(re);
    if (m) {
      make = canonical;
      modelRemainder = modelRemainder.slice(m[0].length).trim();
      break;
    }
  }

  if (!make && modelRemainder) {
    const firstSpace = modelRemainder.indexOf(" ");
    const firstToken = firstSpace === -1 ? modelRemainder : modelRemainder.slice(0, firstSpace);
    const canonical = SINGLE_TOKEN_MAKE_CANONICAL[firstToken.toLowerCase()];
    if (canonical) {
      make = canonical;
      modelRemainder = firstSpace === -1 ? "" : modelRemainder.slice(firstSpace + 1).trim();
    } else if (firstToken) {
      make = firstToken.length <= 3
        ? firstToken.toUpperCase()
        : firstToken.charAt(0).toUpperCase() + firstToken.slice(1).toLowerCase();
      modelRemainder = firstSpace === -1 ? "" : modelRemainder.slice(firstSpace + 1).trim();
    }
  }

  const facets = extractVehicleFacets({
    year,
    make,
    model: modelRemainder || null,
    title: rawTitle || null,
    url: url || null,
  });

  const resolvedModel = facets.canonical_model || cleanRemainderModel(modelRemainder) || null;

  return {
    year,
    make,
    model: resolvedModel,
    facets,
  };
}

function cleanRemainderModel(raw: string): string | null {
  if (!raw) return null;
  let s = raw
    // Strip trailing build descriptors that are not model names
    .replace(/\b(?:custom\s+pickup|custom\s+coupe|custom\s+convertible|custom\s+sedan|custom\s+wagon|custom\s+suv|custom\s+hardtop|custom\s+fastback|custom\s+roadster|custom\s+truck|custom|restomod|hot\s+rod|street\s+rod|pro[-\s]?touring)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = raw.trim();
  return s || null;
}

/**
 * Extracts deterministic collector facets (`series_code`, `trim_package`, `body_style_facet`,
 * `canonical_model`, `drivetrain_hint`, `bed_length`, `cab_style`, `build_kind`) from a
 * vehicle's year, make, model, title, URL slug, and optional catalog description.
 */
export function extractVehicleFacets(
  input: VehicleFacetInput,
): VehicleFacets {
  const year = input.year ?? null;
  const make = canonicalizeMakeToken(input.make);
  const slugText = extractSlugTextFromUrl(input.url);
  // Combine title, model, slug, and first 300 chars of description for rich pattern matching
  const descHead = input.description ? input.description.slice(0, 300) : "";
  const combined = [input.title || "", input.model || "", slugText, descHead]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  let canonicalModel: string | null = null;
  let seriesCode: string | null = input.seriesHint?.trim() || null;
  let trimPackage: string | null = input.trimHint?.trim() || null;
  let bodyStyleFacet: string | null = null;
  let drivetrainHint: "2WD" | "4WD" | null = null;
  let bedLength: "Short Bed" | "Long Bed" | null = null;
  let cabStyle: string | null = null;
  let buildKind: "Restomod" | "Custom" | "Hot Rod" | null = null;

  // ── Build Kind (Restomod / Hot Rod / Custom) ────────────────────────────
  if (/\b(?:restomod|resto[-\s]?mod|pro[-\s]?touring)\b/i.test(combined)) {
    buildKind = "Restomod";
  } else if (/\b(?:hot\s+rod|street\s+rod|rat\s+rod|hi[-\s]?boy|highboy\s+roadster)\b/i.test(combined)) {
    buildKind = "Hot Rod";
  } else if (/\bcustom\b/i.test(combined) && !/\bcustom\s+(?:deluxe|cab|sport|cruiser|500|300|royal|line|series|stylemaster|fleetmaster)\b/i.test(combined)) {
    buildKind = "Custom";
  }

  // ── Bed Length & Cab Style (Pickups/Trucks) ─────────────────────────────
  if (/\b(?:short[-\s]?bed|short[-\s]?box|short\s+wide)\b/i.test(combined)) {
    bedLength = "Short Bed";
  } else if (/\b(?:long[-\s]?bed|long[-\s]?box|long\s+wide)\b/i.test(combined)) {
    bedLength = "Long Bed";
  }

  if (/\bcrew[-\s]?cab\b/i.test(combined)) {
    cabStyle = "Crew Cab";
  } else if (/\b(?:extended[-\s]?cab|super[-\s]?cab|club[-\s]?cab|king[-\s]?cab|extra[-\s]?cab)\b/i.test(combined)) {
    cabStyle = "Extended Cab";
  } else if (/\b(?:half[-\s]?cab)\b/i.test(combined)) {
    cabStyle = "Half-Cab";
  } else if (/\b(?:regular[-\s]?cab|single[-\s]?cab|standard[-\s]?cab|custom[-\s]?cab|five[-\s]?window|5[-\s]?window|three[-\s]?window|3[-\s]?window)\b/i.test(combined)) {
    if (/\b(?:five[-\s]?window|5[-\s]?window)\b/i.test(combined)) {
      cabStyle = "5-Window Cab";
    } else if (/\b(?:three[-\s]?window|3[-\s]?window)\b/i.test(combined) && /\b(?:pickup|truck|3100|3600|apache)\b/i.test(combined)) {
      cabStyle = "3-Window Cab";
    } else {
      cabStyle = "Regular Cab";
    }
  }

  const makeLower = (make || "").toLowerCase();

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CHEVROLET / GMC TRUCKS & SUVs
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "chevrolet" || makeLower === "gmc") {
    // K5 Blazer / Jimmy
    if (/\b(?:k5\s+blazer|blazer\s+k5|k\/5\s+blazer|\bblazer\b|\bjimmy\b)\b/i.test(combined)) {
      const isJimmy = makeLower === "gmc" || /\bjimmy\b/i.test(combined);
      canonicalModel = isJimmy ? "Jimmy" : "K5 Blazer";
      if (/\bk[-\s/]?5\b/i.test(combined) || (year !== null && year >= 1969 && year <= 1991)) {
        seriesCode = "K5";
      }
      if (/\b2wd\b/i.test(combined)) {
        drivetrainHint = "2WD";
      } else {
        drivetrainHint = "4WD";
      }
      bodyStyleFacet = "SUV";
      const gmTrim = matchGmTruckTrim(combined);
      if (gmTrim) trimPackage = gmTrim;
    }
    // Suburban
    else if (/\bsuburban\b/i.test(combined)) {
      canonicalModel = "Suburban";
      const ck = matchGmCkSeries(combined);
      if (ck) {
        seriesCode = ck.series;
        drivetrainHint = ck.drivetrain;
      } else if (/\b3100\b/i.test(combined)) {
        seriesCode = "3100";
      }
      bodyStyleFacet = "SUV";
      const gmTrim = matchGmTruckTrim(combined);
      if (gmTrim) trimPackage = gmTrim;
    }
    // El Camino / Caballero / Sprint
    else if (/\b(?:el\s+camino|caballero|sprint)\b/i.test(combined) && !/\bgmc\s+sprint\b/i.test(combined) && makeLower === "chevrolet") {
      canonicalModel = "El Camino";
      bodyStyleFacet = "Pickup";
      if (/\bss\s*454\b|\b454\s+ss\b/i.test(combined)) {
        trimPackage = "SS 454";
      } else if (/\bss\s*396\b|\b396\s+ss\b/i.test(combined)) {
        trimPackage = "SS 396";
      } else if (/\b(?:super\s+sport|\bss\b)\b/i.test(combined)) {
        trimPackage = "SS";
      } else if (/\bconquista\b/i.test(combined)) {
        trimPackage = "Conquista";
      } else if (/\bcustom\b/i.test(combined) && year && year <= 1974) {
        trimPackage = "Custom";
      }
    }
    // C/K Series & Advance Design / Task Force Pickups
    else {
      const ck = matchGmCkSeries(combined);
      const earlySeries = matchGmEarlyTruckSeries(combined, year);
      const isPickupHeadline =
        ck !== null ||
        earlySeries !== null ||
        /\b(?:stepside|fleetside|short[-\s]?bed|long[-\s]?bed|cameo|apache|viking|spartan|handyman)\b/i.test(combined) ||
        (/\b(?:pickup|truck|panel\s+truck|panel\s+delivery|canopy\s+express)\b/i.test(combined) &&
          !/\b(?:corvair|luv|s[-\s]?10|colorado|avalanche|ssr)\b/i.test(combined));

      if (isPickupHeadline) {
        if (ck) {
          seriesCode = ck.series;
          drivetrainHint = ck.drivetrain;
          canonicalModel = ck.series;
        } else if (earlySeries) {
          seriesCode = earlySeries;
          canonicalModel = earlySeries === "Cameo Carrier" ? "3124 Cameo" : earlySeries;
          drivetrainHint = /\b4x4\b|\b4wd\b|\bnapco\b/i.test(combined) ? "4WD" : "2WD";
        } else if (year !== null && year >= 1947 && year <= 1955 && /\b(?:pickup|truck)\b/i.test(combined)) {
          seriesCode = "3100";
          canonicalModel = "3100";
        } else if (year !== null && year >= 1960 && year <= 1987 && /\b(?:pickup|truck)\b/i.test(combined)) {
          seriesCode = /\b(?:4x4|4wd)\b/i.test(combined) ? "K10" : "C10";
          drivetrainHint = seriesCode === "K10" ? "4WD" : "2WD";
          canonicalModel = seriesCode;
        }

        const gmTrim = matchGmTruckTrim(combined);
        if (gmTrim) trimPackage = gmTrim;

        if (/\bpanel\b/i.test(combined)) {
          bodyStyleFacet = "Panel";
        } else if (/\bstepside\b/i.test(combined)) {
          bodyStyleFacet = "Stepside";
        } else if (/\bfleetside\b|\bwideside\b/i.test(combined)) {
          bodyStyleFacet = "Fleetside";
        } else if (/\bcameo\b/i.test(combined)) {
          bodyStyleFacet = "Fleetside";
          if (!trimPackage) trimPackage = "Cameo";
        } else if (cabStyle === "Crew Cab") {
          bodyStyleFacet = "Crew Cab";
        } else if (bedLength) {
          bodyStyleFacet = bedLength;
        } else {
          bodyStyleFacet = "Pickup";
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. CHEVROLET PASSENGER CARS (Chevelle, Camaro, Corvette, Tri-Five, Impala, Nova)
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "chevrolet" && !seriesCode) {
    // Chevelle / Malibu
    if (/\b(?:chevelle|malibu)\b/i.test(combined)) {
      canonicalModel = "Chevelle";
      if (/\bmalibu\b/i.test(combined)) {
        seriesCode = "Malibu";
      } else if (/\b300\s+deluxe\b/i.test(combined)) {
        seriesCode = "300 Deluxe";
      }

      if (/\byenko\b/i.test(combined)) {
        trimPackage = "Yenko SC 427";
      } else if (/\bcopo\b/i.test(combined)) {
        trimPackage = "COPO 427";
      } else if (/\bss\s*454\b|\b454\s+ss\b|\bls6\b/i.test(combined)) {
        trimPackage = /\bls6\b/i.test(combined) ? "SS 454 LS6" : "SS 454";
      } else if (/\bss\s*396\b|\b396\s+ss\b|\bl78\b/i.test(combined)) {
        trimPackage = /\bl78\b/i.test(combined) ? "SS 396 L78" : "SS 396";
      } else if (/\bz[-\s]?16\b/i.test(combined)) {
        trimPackage = "SS 396 Z16";
      } else if (/\b(?:super\s+sport|\bss\b)\b/i.test(combined)) {
        trimPackage = "SS";
      } else if (/\bmalibu\b/i.test(combined)) {
        trimPackage = "Malibu";
      } else if (/\bconcours\b/i.test(combined)) {
        trimPackage = "Concours";
      }
    }
    // Camaro
    else if (/\bcamaro\b/i.test(combined)) {
      canonicalModel = "Camaro";
      if (year !== null) {
        if (year >= 1967 && year <= 1969) seriesCode = "1st Gen";
        else if (year >= 1970 && year <= 1981) seriesCode = "2nd Gen";
        else if (year >= 1982 && year <= 1992) seriesCode = "3rd Gen";
      }

      if (/\byenko\b/i.test(combined)) {
        trimPackage = "Yenko SC 427";
      } else if (/\bcopo\b/i.test(combined)) {
        trimPackage = "COPO";
      } else if (/\bzl[-\s]?1\b/i.test(combined)) {
        trimPackage = "ZL1";
      } else if (/\brs\s*\/\s*ss\b|\bss\s*\/\s*rs\b|\brs\s+ss\b|\bss\s+rs\b/i.test(combined)) {
        trimPackage = "RS/SS";
      } else if (/\brs\s*\/\s*z\s*\/?\s*28\b|\bz\s*\/?\s*28\s+rs\b|\brs\s+z\s*\/?\s*28\b/i.test(combined)) {
        trimPackage = "RS/Z28";
      } else if (/\biroc[-\s]?z\b/i.test(combined)) {
        trimPackage = "IROC-Z";
      } else if (/\bz\s*\/?\s*28\b/i.test(combined)) {
        trimPackage = "Z/28";
      } else if (/\bss\s*396\b|\b396\s+ss\b/i.test(combined)) {
        trimPackage = "SS 396";
      } else if (/\bss\s*350\b|\b350\s+ss\b/i.test(combined)) {
        trimPackage = "SS 350";
      } else if (/\b(?:super\s+sport|\bss\b)\b/i.test(combined)) {
        trimPackage = "SS";
      } else if (/\b(?:rally\s+sport|\brs\b)\b/i.test(combined)) {
        trimPackage = "RS";
      } else if (/\bberlinetta\b/i.test(combined)) {
        trimPackage = "Berlinetta";
      } else if (/\bpace\s+car\b/i.test(combined)) {
        trimPackage = "Pace Car";
      }
    }
    // Corvette
    else if (/\b(?:corvette|sting\s*ray)\b/i.test(combined)) {
      canonicalModel = "Corvette";
      if (year !== null) {
        if (year >= 1953 && year <= 1962) seriesCode = "C1";
        else if (year >= 1963 && year <= 1967) seriesCode = "C2 Sting Ray";
        else if (year >= 1968 && year <= 1982) seriesCode = "C3 Stingray";
        else if (year >= 1984 && year <= 1996) seriesCode = "C4";
        else if (year >= 1997 && year <= 2004) seriesCode = "C5";
        else if (year >= 2005 && year <= 2013) seriesCode = "C6";
        else if (year >= 2014 && year <= 2019) seriesCode = "C7";
        else if (year >= 2020) seriesCode = "C8";
      }

      if (/\bl88\b/i.test(combined)) {
        trimPackage = "L88";
      } else if (/\bzr[-\s]?1\b/i.test(combined)) {
        trimPackage = "ZR1";
      } else if (/\bz06\b/i.test(combined)) {
        trimPackage = "Z06";
      } else if (/\bgrand\s+sport\b/i.test(combined)) {
        trimPackage = "Grand Sport";
      } else if (/\b427\s*\/\s*435\b/i.test(combined)) {
        trimPackage = "427/435";
      } else if (/\b427\s*\/\s*400\b/i.test(combined)) {
        trimPackage = "427/400";
      } else if (/\b427\s*\/\s*390\b/i.test(combined)) {
        trimPackage = "427/390";
      } else if (/\b427\b/i.test(combined) && year && year >= 1966 && year <= 1969) {
        trimPackage = "427";
      } else if (/\bfuel[-\s]?injected\b|\bfuelie\b/i.test(combined)) {
        trimPackage = "Fuelie";
      } else if (/\bpace\s+car\b/i.test(combined)) {
        trimPackage = "Pace Car";
      }

      if (/\bsplit[-\s]?window\b/i.test(combined) || (year === 1963 && /\bcoupe\b/i.test(combined))) {
        bodyStyleFacet = "Split-Window Coupe";
      } else if (/\bt[-\s]?top\b/i.test(combined)) {
        bodyStyleFacet = "T-Top";
      }
    }
    // Tri-Five & Bel Air / 210 / 150 / Nomad
    else if (/\b(?:bel\s+air|nomad|two[-\s]?ten|210|one[-\s]?fifty|150)\b/i.test(combined) && year && year >= 1950 && year <= 1975) {
      if (/\bnomad\b/i.test(combined)) {
        canonicalModel = "Bel Air";
        seriesCode = "Nomad";
        trimPackage = "Nomad";
        bodyStyleFacet = "Wagon";
      } else if (/\bbel\s+air\b/i.test(combined)) {
        canonicalModel = "Bel Air";
        seriesCode = year >= 1955 && year <= 1957 ? "Tri-Five Bel Air" : "Bel Air";
      } else if (/\b(?:two[-\s]?ten|210)\b/i.test(combined)) {
        canonicalModel = "210";
        seriesCode = year >= 1955 && year <= 1957 ? "Tri-Five 210" : "210";
      } else if (/\b(?:one[-\s]?fifty|150)\b/i.test(combined)) {
        canonicalModel = "150";
        seriesCode = year >= 1955 && year <= 1957 ? "Tri-Five 150" : "150";
      }
    }
    // Impala / Biscayne / Caprice
    else if (/\bimpala\b/i.test(combined)) {
      canonicalModel = "Impala";
      if (/\bss\s*427\b|\b427\s+ss\b/i.test(combined)) {
        trimPackage = "SS 427";
      } else if (/\bss\s*409\b|\b409\s+ss\b|\b409\b/i.test(combined)) {
        trimPackage = /\bss\b/i.test(combined) ? "SS 409" : "409";
      } else if (/\bss\s*396\b/i.test(combined)) {
        trimPackage = "SS 396";
      } else if (/\b(?:super\s+sport|\bss\b)\b/i.test(combined)) {
        trimPackage = "SS";
      }
    }
    // Nova / Chevy II
    else if (/\b(?:chevy\s+ii|nova)\b/i.test(combined)) {
      canonicalModel = "Nova";
      if (/\bchevy\s+ii\b/i.test(combined)) seriesCode = "Chevy II";
      if (/\byenko\b/i.test(combined)) trimPackage = "Yenko Deuce";
      else if (/\bss\s*396\b/i.test(combined)) trimPackage = "SS 396";
      else if (/\b(?:super\s+sport|\bss\b)\b/i.test(combined)) trimPackage = "SS";
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. FORD BRONCO, MUSTANG / SHELBY, & F-SERIES TRUCKS
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "ford" || makeLower === "shelby") {
    // Ford Bronco
    if (/\bbronco\b/i.test(combined)) {
      canonicalModel = "Bronco";
      drivetrainHint = "4WD";

      if (/\bu13\b/i.test(combined) || (year && year >= 1966 && year <= 1968 && /\broadster\b/i.test(combined))) {
        seriesCode = "U13 Roadster";
        bodyStyleFacet = "Roadster";
      } else if (/\bu14\b|\bhalf[-\s]?cab\b/i.test(combined)) {
        seriesCode = "U14 Half-Cab";
        bodyStyleFacet = "Half-Cab";
        cabStyle = "Half-Cab";
      } else if (/\bu15\b/i.test(combined) || (year && year >= 1966 && year <= 1977)) {
        seriesCode = "U15 Wagon";
        bodyStyleFacet = "SUV";
      } else {
        bodyStyleFacet = "SUV";
      }

      if (/\bstroppe\b|\bbaja\s+bronco\b/i.test(combined)) {
        trimPackage = "Stroppe Baja";
      } else if (/\branger\b/i.test(combined)) {
        trimPackage = "Ranger";
      } else if (/\bsport\b/i.test(combined) && (!year || year < 2021)) {
        trimPackage = "Sport";
      } else if (/\beddie\s+bauer\b/i.test(combined)) {
        trimPackage = "Eddie Bauer";
      } else if (/\bxlt\s+lariat\b/i.test(combined)) {
        trimPackage = "XLT Lariat";
      } else if (/\bxlt\b/i.test(combined)) {
        trimPackage = "XLT";
      }
    }
    // Shelby Cobra (when make is Shelby or Ford)
    else if (/\bcobra\b/i.test(combined) && !/\b(?:mustang|gt350|gt500|torino|fairlane)\b/i.test(combined)) {
      canonicalModel = "Cobra";
      if (/\b427\b/i.test(combined)) {
        seriesCode = "427 Cobra";
        if (/\bs\/c\b|\bsemi[-\s]?competition\b/i.test(combined)) trimPackage = "S/C";
      } else if (/\b289\b/i.test(combined)) {
        seriesCode = "289 Cobra";
        if (/\bfia\b|\busrrc\b/i.test(combined)) trimPackage = "FIA";
      }
      bodyStyleFacet = /\bdaytona\s+coupe\b/i.test(combined) ? "Coupe" : "Roadster";
    }
    // Mustang / Shelby GT350 / GT500 / Boss / Mach 1
    else if (/\b(?:mustang|shelby\s+gt|gt350|gt500|boss\s+302|boss\s+429|boss\s+351|mach\s+1)\b/i.test(combined)) {
      canonicalModel = "Mustang";

      if (/\bshelby\s+gt500\s*kr\b|\bgt500kr\b/i.test(combined)) {
        seriesCode = "Shelby GT500KR";
        trimPackage = "GT500KR";
      } else if (/\bshelby\s+gt500\b|\bgt500\b/i.test(combined)) {
        seriesCode = "Shelby GT500";
        trimPackage = "GT500";
      } else if (/\bshelby\s+gt350\s*h\b|\bgt350h\b/i.test(combined)) {
        seriesCode = "Shelby GT350H";
        trimPackage = "GT350H";
      } else if (/\bshelby\s+gt350\s*r\b|\bgt350r\b/i.test(combined)) {
        seriesCode = "Shelby GT350R";
        trimPackage = "GT350R";
      } else if (/\bshelby\s+gt350\b|\bgt350\b/i.test(combined)) {
        seriesCode = "Shelby GT350";
        trimPackage = "GT350";
      } else if (/\bboss\s+429\b/i.test(combined)) {
        seriesCode = "Boss 429";
        trimPackage = "Boss 429";
      } else if (/\bboss\s+302\b/i.test(combined)) {
        seriesCode = "Boss 302";
        trimPackage = "Boss 302";
      } else if (/\bboss\s+351\b/i.test(combined)) {
        seriesCode = "Boss 351";
        trimPackage = "Boss 351";
      } else if (/\bmach\s+1\b/i.test(combined)) {
        seriesCode = "Mach 1";
        trimPackage = /\bcobra\s+jet\b/i.test(combined) ? "Mach 1 Cobra Jet" : "Mach 1";
      } else if (/\bcalifornia\s+special\b|\bgt\/cs\b/i.test(combined)) {
        trimPackage = "GT/CS";
      } else if (/\bk[-\s]?code\b/i.test(combined)) {
        trimPackage = "K-Code 289";
      } else if (/\bcobra\s+jet\b/i.test(combined)) {
        trimPackage = "Cobra Jet";
      } else if (/\bsvt\s+cobra\s+r\b/i.test(combined)) {
        trimPackage = "SVT Cobra R";
      } else if (/\bsvt\s+cobra\b|\bterminator\b/i.test(combined)) {
        trimPackage = "SVT Cobra";
      } else if (/\bbullitt\b/i.test(combined)) {
        trimPackage = "Bullitt";
      } else if (/\bgt\b/i.test(combined)) {
        trimPackage = "GT";
      }

      if (/\b(?:fastback|sportsroof|2\+2)\b/i.test(combined)) {
        bodyStyleFacet = "Fastback";
      } else if (/\bconvertible\b/i.test(combined)) {
        bodyStyleFacet = "Convertible";
      } else if (/\b(?:hardtop|coupe|notchback|grande)\b/i.test(combined)) {
        bodyStyleFacet = "Coupe";
      } else if (seriesCode && /^(?:Shelby GT350|Boss 302|Boss 429|Boss 351|Mach 1)/.test(seriesCode)) {
        bodyStyleFacet = "Fastback";
      }
    }
    // Ford F-Series Trucks (F-1, F-100, F-150, F-250, F-350)
    else if (/\b(?:f[-\s]?100|f[-\s]?150|f[-\s]?250|f[-\s]?350|f[-\s]?1|f[-\s]?2|f[-\s]?3)\b/i.test(combined)) {
      const fMatch = combined.match(/\bf[-\s]?(100|150|250|350|1|2|3)\b/i);
      if (fMatch) {
        seriesCode = `F-${fMatch[1]}`;
        canonicalModel = seriesCode;
      }
      drivetrainHint = /\b(?:4x4|4wd|highboy)\b/i.test(combined) ? "4WD" : "2WD";

      if (/\bharley[-\s]?davidson\b/i.test(combined)) {
        trimPackage = "Harley-Davidson";
      } else if (/\bsvt\s+lightning\b|\blightning\b/i.test(combined)) {
        trimPackage = "SVT Lightning";
      } else if (/\braptor\b/i.test(combined)) {
        trimPackage = "Raptor";
      } else if (/\branger\s+xlt\b/i.test(combined)) {
        trimPackage = "Ranger XLT";
      } else if (/\branger\s+lariat\b/i.test(combined)) {
        trimPackage = "Ranger Lariat";
      } else if (/\bxlt\s+lariat\b/i.test(combined)) {
        trimPackage = "XLT Lariat";
      } else if (/\branger\b/i.test(combined)) {
        trimPackage = "Ranger";
      } else if (/\blariat\b/i.test(combined)) {
        trimPackage = "Lariat";
      } else if (/\bxlt\b/i.test(combined)) {
        trimPackage = "XLT";
      } else if (/\bcustom\s+cab\b/i.test(combined)) {
        trimPackage = "Custom Cab";
      }

      if (/\bflareside\b|\bstepside\b/i.test(combined)) {
        bodyStyleFacet = "Flareside";
      } else if (/\bstyleside\b|\bfleetside\b/i.test(combined)) {
        bodyStyleFacet = "Styleside";
      } else if (cabStyle === "Crew Cab") {
        bodyStyleFacet = "Crew Cab";
      } else if (bedLength) {
        bodyStyleFacet = bedLength;
      } else {
        bodyStyleFacet = "Pickup";
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. MOPAR (Plymouth & Dodge)
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "plymouth" || makeLower === "dodge") {
    // Plymouth Superbird / Road Runner / GTX
    if (/\b(?:superbird|road\s+runner|gtx)\b/i.test(combined)) {
      if (/\bsuperbird\b/i.test(combined)) {
        canonicalModel = "Road Runner Superbird";
        seriesCode = "Superbird";
      } else if (/\broad\s+runner\b/i.test(combined)) {
        canonicalModel = "Road Runner";
        seriesCode = "Road Runner";
      } else {
        canonicalModel = "GTX";
        seriesCode = "GTX";
      }

      if (/\b426\s+hemi\b|\bhemi\b/i.test(combined)) {
        trimPackage = "426 Hemi";
      } else if (/\b440\s+six\s+pack\b|\b440\s+six\s+barrel\b|\b440\s*6[-\s]?bbl\b|\bsix\s+barrel\b|\bsix\s+pack\b|\bv[-\s]?code\b/i.test(combined)) {
        trimPackage = "440 Six Barrel";
      } else if (/\b440\b/i.test(combined)) {
        trimPackage = "440";
      } else if (/\b383\b/i.test(combined)) {
        trimPackage = "383";
      }
    }
    // Plymouth Barracuda / 'Cuda
    else if (/\b(?:barracuda|['’]?cuda|hemi\s*['’]?cuda|aar\s*['’]?cuda)\b/i.test(combined)) {
      canonicalModel = /\b['’]?cuda\b/i.test(combined) && year && year >= 1970 && year <= 1974 ? "'Cuda" : "Barracuda";
      if (/\baar\s*['’]?cuda\b|\baar\b/i.test(combined)) {
        seriesCode = "AAR 'Cuda";
        trimPackage = "AAR 340 Six Barrel";
      } else if (/\bhemi\s*['’]?cuda\b|\b426\s+hemi\b|\bhemi\b/i.test(combined)) {
        seriesCode = "Hemi 'Cuda";
        trimPackage = "426 Hemi";
      } else if (/\b440\s+six\s+barrel\b|\b440\s+six\s+pack\b|\b440[-\s]?6\b|\bv[-\s]?code\b/i.test(combined)) {
        seriesCode = "'Cuda 440-6";
        trimPackage = "440 Six Barrel";
      } else if (/\bformula\s+s\b/i.test(combined)) {
        trimPackage = "Formula S";
      } else if (/\bgran\s+coupe\b/i.test(combined)) {
        trimPackage = "Gran Coupe";
      }
    }
    // Dodge Charger / Charger Daytona
    else if (/\bcharger\b/i.test(combined)) {
      canonicalModel = "Charger";
      if (/\bdaytona\b/i.test(combined)) {
        seriesCode = "Charger Daytona";
      } else if (/\bcharger\s+500\b/i.test(combined)) {
        seriesCode = "Charger 500";
      }

      if (/\br\/t\s+se\b/i.test(combined)) {
        trimPackage = "R/T SE";
      } else if (/\b426\s+hemi\b|\bhemi\b/i.test(combined)) {
        trimPackage = /\br\/t\b/i.test(combined) ? "R/T 426 Hemi" : "426 Hemi";
      } else if (/\b440\s+six\s+pack\b|\bsix\s+pack\b/i.test(combined)) {
        trimPackage = /\br\/t\b/i.test(combined) ? "R/T 440 Six Pack" : "440 Six Pack";
      } else if (/\br\/t\b/i.test(combined)) {
        trimPackage = "R/T";
      } else if (/\bsuper\s+bee\b/i.test(combined)) {
        trimPackage = "Super Bee";
      }
    }
    // Dodge Challenger
    else if (/\bchallenger\b/i.test(combined)) {
      canonicalModel = "Challenger";
      if (/\bt\/a\b/i.test(combined)) {
        seriesCode = "Challenger T/A";
        trimPackage = "T/A 340 Six Pack";
      } else if (/\br\/t\s+se\b/i.test(combined)) {
        trimPackage = "R/T SE";
      } else if (/\b426\s+hemi\b|\bhemi\s+r\/t\b/i.test(combined)) {
        trimPackage = "R/T 426 Hemi";
      } else if (/\b440\s+six\s+pack\b/i.test(combined)) {
        trimPackage = "R/T 440 Six Pack";
      } else if (/\br\/t\b/i.test(combined)) {
        trimPackage = "R/T";
      } else if (/\bsrt\s+demon\b|\bdemon\s+170\b/i.test(combined)) {
        trimPackage = /\b170\b/i.test(combined) ? "SRT Demon 170" : "SRT Demon";
      } else if (/\bsrt\s+hellcat\s+redeye\b/i.test(combined)) {
        trimPackage = "SRT Hellcat Redeye";
      } else if (/\bsrt\s+hellcat\b|\bhellcat\b/i.test(combined)) {
        trimPackage = "SRT Hellcat";
      }
    }
    // Dodge Power Wagon / D100 / W100
    else if (/\b(?:power\s+wagon|d[-\s]?100|d[-\s]?150|w[-\s]?100|w[-\s]?150|w[-\s]?200|lil['’]?\s*red\s+express|warlock)\b/i.test(combined)) {
      if (/\bpower\s+wagon\b/i.test(combined)) {
        canonicalModel = "Power Wagon";
        seriesCode = /\bwm300\b/i.test(combined) ? "WM300" : "Power Wagon";
        drivetrainHint = "4WD";
      } else {
        const dw = combined.match(/\b([dw])[-\s]?(100|150|200|250|300)\b/i);
        if (dw) {
          seriesCode = `${dw[1].toUpperCase()}${dw[2]}`;
          canonicalModel = seriesCode;
          drivetrainHint = dw[1].toUpperCase() === "W" ? "4WD" : "2WD";
        }
      }
      if (/\blil['’]?\s*red\s+express\b/i.test(combined)) {
        trimPackage = "Li'l Red Express";
      } else if (/\bwarlock\b/i.test(combined)) {
        trimPackage = "Warlock";
      } else if (/\badventurer\b/i.test(combined)) {
        trimPackage = "Adventurer";
      }
      if (/\bsweptline\b/i.test(combined)) {
        bodyStyleFacet = "Sweptline";
      } else if (/\butiline\b|\bstepside\b/i.test(combined)) {
        bodyStyleFacet = "Stepside";
      } else {
        bodyStyleFacet = "Pickup";
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. PONTIAC (GTO / Judge, Firebird / Trans Am)
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "pontiac") {
    if (/\bgto\b/i.test(combined)) {
      canonicalModel = "GTO";
      if (/\bthe\s+judge\b|\bjudge\b/i.test(combined)) {
        seriesCode = "The Judge";
        trimPackage = /\bram\s+air\s+iv\b/i.test(combined) ? "The Judge Ram Air IV" : "The Judge";
      } else if (/\bram\s+air\s+iv\b/i.test(combined)) {
        trimPackage = "Ram Air IV";
      } else if (/\bram\s+air\s+iii\b|\bram\s+air\b/i.test(combined)) {
        trimPackage = "Ram Air";
      } else if (/\btri[-\s]?power\b/i.test(combined)) {
        trimPackage = "Tri-Power";
      }
    } else if (/\b(?:firebird|trans\s+am|formula)\b/i.test(combined)) {
      canonicalModel = "Firebird";
      if (/\btrans\s+am\b/i.test(combined)) {
        seriesCode = "Trans Am";
        if (/\bsd[-\s]?455\b|\bsuper\s+duty\b/i.test(combined)) {
          trimPackage = "Trans Am SD-455";
        } else if (/\bram\s+air\s+iv\b/i.test(combined)) {
          trimPackage = "Trans Am Ram Air IV";
        } else if (/\b455\s+ho\b/i.test(combined)) {
          trimPackage = "Trans Am 455 HO";
        } else if (/\bspecial\s+edition\b|\bbandit\b|\by82\b|\by84\b/i.test(combined)) {
          trimPackage = "Trans Am Special Edition";
        } else {
          trimPackage = "Trans Am";
        }
      } else if (/\bformula\b/i.test(combined)) {
        seriesCode = "Formula";
        trimPackage = /\b400\b/i.test(combined) ? "Formula 400" : "Formula";
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. PORSCHE (356, 911 / 930 / 964 / 993 / 996 / 997 / 991 / 992, 912, 914, 928, Carrera GT)
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "porsche") {
    // Porsche 356
    if (/\b356\s*[abc]?\b/i.test(combined)) {
      canonicalModel = "356";
      if (/\bpre[-\s]?a\b/i.test(combined)) {
        seriesCode = "356 Pre-A";
      } else if (/\b356\s*a\b/i.test(combined)) {
        seriesCode = "356A";
      } else if (/\b356\s*b\b/i.test(combined)) {
        seriesCode = "356B";
      } else if (/\b356\s*c\b/i.test(combined)) {
        seriesCode = "356C";
      } else {
        seriesCode = "356";
      }

      if (/\bcarrera\s*2\b/i.test(combined)) {
        trimPackage = "Carrera 2";
      } else if (/\bcarrera\b/i.test(combined)) {
        trimPackage = "Carrera";
      } else if (/\b(?:1600\s*)?sc\b/i.test(combined)) {
        trimPackage = "1600 SC";
      } else if (/\bsuper\s*90\b|\bs90\b/i.test(combined)) {
        trimPackage = "Super 90";
      } else if (/\b1600\s*super\b|\b1600\s*s\b|\bsuper\b/i.test(combined)) {
        trimPackage = "1600 Super";
      } else if (/\b1600\b/i.test(combined)) {
        trimPackage = "1600";
      } else if (/\b1500\s*super\b/i.test(combined)) {
        trimPackage = "1500 Super";
      } else if (/\b1500\b/i.test(combined)) {
        trimPackage = "1500";
      }

      if (/\bspeedster\b/i.test(combined)) {
        if (!trimPackage) trimPackage = "Speedster";
        bodyStyleFacet = "Roadster";
      } else if (/\bconvertible\s+d\b|\broadster\b/i.test(combined)) {
        bodyStyleFacet = "Roadster";
      } else if (/\bcabriolet\b|\bconvertible\b/i.test(combined)) {
        bodyStyleFacet = "Convertible";
      } else if (/\bcoup[eé]\b|\bkarmann\s+hardtop\b/i.test(combined)) {
        bodyStyleFacet = "Coupe";
      }
    }
    // Porsche 911 / 930 / Carrera / GT3 / GT2
    else if (/\b(?:911|930|964|993|996|997|991|992|carrera\s+rs|carrera\s+4s|carrera\s+s|gt3\s+rs|gt2\s+rs)\b/i.test(combined) && !/\bcarrera\s+gt\b/i.test(combined)) {
      canonicalModel = "911";
      if (/\bcarrera\s+rs\s+2\.7\b|\brs\s+2\.7\b/i.test(combined)) {
        seriesCode = "Carrera RS 2.7";
      } else if (/\bcarrera\s+rs\s+3\.8\b/i.test(combined)) {
        seriesCode = "Carrera RS 3.8";
      } else if (/\bcarrera\s+rsr\b/i.test(combined)) {
        seriesCode = "Carrera RSR";
      } else if (/\bcarrera\s+rs\b/i.test(combined)) {
        seriesCode = "Carrera RS";
      } else if (/\bgt3\s+rs\b/i.test(combined)) {
        seriesCode = "GT3 RS";
      } else if (/\bgt3\b/i.test(combined)) {
        seriesCode = "GT3";
      } else if (/\bgt2\s+rs\b/i.test(combined)) {
        seriesCode = "GT2 RS";
      } else if (/\bgt2\b/i.test(combined)) {
        seriesCode = "GT2";
      } else if (/\b930\b/i.test(combined) || (year && year >= 1975 && year <= 1989 && /\bturbo\b/i.test(combined))) {
        seriesCode = "930 Turbo";
      } else if (/\bturbo\s+s\b/i.test(combined)) {
        seriesCode = "911 Turbo S";
      } else if (/\bturbo\b/i.test(combined)) {
        seriesCode = "911 Turbo";
      } else if (/\bcarrera\s+4s\b|\bc4s\b/i.test(combined)) {
        seriesCode = "Carrera 4S";
      } else if (/\bcarrera\s+s\b/i.test(combined)) {
        seriesCode = "Carrera S";
      } else if (/\bcarrera\s+4\b|\bc4\b/i.test(combined)) {
        seriesCode = "Carrera 4";
      } else if (/\bcarrera\b/i.test(combined)) {
        seriesCode = "Carrera";
      } else if (/\b911\s*sc\b/i.test(combined)) {
        seriesCode = "911 SC";
      } else if (/\b911\s*s\b/i.test(combined)) {
        seriesCode = "911S";
      } else if (/\b911\s*e\b/i.test(combined)) {
        seriesCode = "911E";
      } else if (/\b911\s*t\b/i.test(combined)) {
        seriesCode = "911T";
      } else if (/\b911\s*r\b/i.test(combined)) {
        seriesCode = "911R";
      } else {
        seriesCode = "911";
      }

      if (/\blightweight\b|\bsport\s*\(m471\)\b|\bm471\b/i.test(combined)) {
        trimPackage = seriesCode === "Carrera RS 2.7" ? "RS 2.7 Lightweight" : "Lightweight";
      } else if (/\btouring\b|\bm472\b/i.test(combined)) {
        trimPackage = seriesCode === "Carrera RS 2.7" ? "RS 2.7 Touring" : "Touring";
      } else if (/\bweissach\b/i.test(combined)) {
        trimPackage = "Weissach Package";
      } else if (/\bsport\s+classic\b/i.test(combined)) {
        trimPackage = "Sport Classic";
      } else if (/\bclubsport\b/i.test(combined)) {
        trimPackage = "Clubsport";
      } else if (/\bflat[-\s]?nose\b|\bslant[-\s]?nose\b|\bflachbau\b/i.test(combined)) {
        trimPackage = "Slantnose";
      } else if (!trimPackage && seriesCode && seriesCode !== "911") {
        trimPackage = seriesCode;
      }

      if (/\btarga\b/i.test(combined)) {
        bodyStyleFacet = "Targa";
      } else if (/\bspeedster\b/i.test(combined)) {
        bodyStyleFacet = "Roadster";
      } else if (/\bcabriolet\b|\bconvertible\b/i.test(combined)) {
        bodyStyleFacet = "Convertible";
      } else {
        bodyStyleFacet = "Coupe";
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. MERCEDES-BENZ (300 SL Gullwing / Roadster, 190 SL, 230/250/280 SL Pagoda, 280 SE 3.5)
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "mercedes-benz") {
    if (/\b300\s*sl\b/i.test(combined)) {
      canonicalModel = "300 SL";
      seriesCode = "300 SL";
      if (/\bgullwing\b|\bcoup[eé]\b/i.test(combined) || (year && year >= 1954 && year <= 1956 && !/\broadster\b/i.test(combined))) {
        trimPackage = /\balloy\b/i.test(combined) ? "Alloy Gullwing" : "Gullwing";
        bodyStyleFacet = "Gullwing Coupe";
      } else if (/\broadster\b/i.test(combined)) {
        trimPackage = "Roadster";
        bodyStyleFacet = "Roadster";
      }
    } else if (/\b190\s*sl\b/i.test(combined)) {
      canonicalModel = "190 SL";
      seriesCode = "190 SL";
      bodyStyleFacet = "Roadster";
    } else if (/\b(230|250|280)\s*sl\b/i.test(combined)) {
      const m = combined.match(/\b(230|250|280)\s*sl\b/i);
      if (m) {
        seriesCode = `${m[1]} SL`;
        canonicalModel = seriesCode;
      }
      if (/\bpagoda\b/i.test(combined) || (year && year >= 1963 && year <= 1971)) {
        trimPackage = "Pagoda";
      }
      bodyStyleFacet = "Roadster";
    } else if (/\b280\s*se\s+3\.5\b/i.test(combined)) {
      canonicalModel = "280 SE";
      seriesCode = "280 SE 3.5";
      trimPackage = "3.5";
    } else if (/\b300\s*sc\b/i.test(combined)) {
      canonicalModel = "300 Sc";
      seriesCode = "300 Sc";
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. JAGUAR (E-Type / XKE, XK120 / XK140 / XK150)
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "jaguar") {
    if (/\b(?:e[-\s]?type|xk[-\s]?e)\b/i.test(combined)) {
      canonicalModel = "E-Type";
      if (/\bseries\s*(?:1|i)\b|\bs1\b/i.test(combined)) {
        seriesCode = "Series 1";
      } else if (/\bseries\s*(?:1\.5|1\s*1\/2)\b/i.test(combined)) {
        seriesCode = "Series 1.5";
      } else if (/\bseries\s*(?:2|ii)\b|\bs2\b/i.test(combined)) {
        seriesCode = "Series 2";
      } else if (/\bseries\s*(?:3|iii)\b|\bs3\b|\bv[-\s]?12\b/i.test(combined)) {
        seriesCode = "Series 3";
      } else if (year && year >= 1961 && year <= 1967) {
        seriesCode = "Series 1";
      } else if (year && year >= 1969 && year <= 1970) {
        seriesCode = "Series 2";
      } else if (year && year >= 1971 && year <= 1974) {
        seriesCode = "Series 3";
      }

      if (/\blightweight\b/i.test(combined)) {
        trimPackage = "Lightweight";
      } else if (/\b3\.8\b/i.test(combined)) {
        trimPackage = "3.8-Litre";
      } else if (/\b4\.2\b/i.test(combined)) {
        trimPackage = "4.2-Litre";
      } else if (/\bv[-\s]?12\b/i.test(combined)) {
        trimPackage = "V12";
      }

      if (/\broadster\b|\bots\b|\bopen\s+two[-\s]?seater\b|\bdrophead\b|\bconvertible\b/i.test(combined)) {
        bodyStyleFacet = "Roadster";
      } else if (/\b2\+2\b/i.test(combined)) {
        bodyStyleFacet = "Fastback";
      } else if (/\bfixed[-\s]?head\b|\bfhc\b|\bcoup[eé]\b/i.test(combined)) {
        bodyStyleFacet = "Coupe";
      }
    } else if (/\bxk\s*(120|140|150)\b/i.test(combined)) {
      const xkMatch = combined.match(/\bxk\s*(120|140|150)\b/i);
      if (xkMatch) {
        seriesCode = `XK${xkMatch[1]}`;
        canonicalModel = seriesCode;
      }
      if (/\bxk\s*(?:120|140|150)\s+s\b|\b3\.8\s+s\b|\b3\.4\s+s\b/i.test(combined)) {
        trimPackage = "S";
      } else if (/\bse\b|\bspecial\s+equipment\b|\bmc\b|\b\bm\b(?=\s+(?:roadster|drophead|fixed))/i.test(combined)) {
        trimPackage = /\bmc\b/i.test(combined) ? "MC" : "SE";
      }

      if (/\bdrophead\s+coup[eé]\b|\bdhc\b|\bconvertible\b/i.test(combined)) {
        bodyStyleFacet = "Convertible";
      } else if (/\broadster\b|\bots\b|\bopen\s+two[-\s]?seater\b/i.test(combined)) {
        bodyStyleFacet = "Roadster";
      } else if (/\bfixed[-\s]?head\s+coup[eé]\b|\bfhc\b|\bcoup[eé]\b/i.test(combined)) {
        bodyStyleFacet = "Coupe";
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. ASTON MARTIN (DB2, DB4, DB5, DB6, DBS, V8 Vantage / Volante)
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "aston martin") {
    if (/\bdb4\s*gt\b/i.test(combined)) {
      canonicalModel = "DB4 GT";
      seriesCode = "DB4 GT";
      trimPackage = /\bzagato\b/i.test(combined) ? "GT Zagato" : "GT";
    } else if (/\b(db2\/4|db2|db4|db5|db6|dbs|db7|db9)\b/i.test(combined)) {
      const dbm = combined.match(/\b(db2\/4|db2|db4|db5|db6|dbs|db7|db9)\b/i);
      if (dbm) {
        seriesCode = dbm[1].toUpperCase();
        canonicalModel = seriesCode;
      }
      if (/\bvantage\b/i.test(combined)) {
        trimPackage = "Vantage";
      } else if (/\bzagato\b/i.test(combined)) {
        trimPackage = "Zagato";
      } else if (/\bvolante\b/i.test(combined)) {
        trimPackage = "Volante";
      }
    } else if (/\bv8\b/i.test(combined)) {
      canonicalModel = "V8";
      seriesCode = "V8";
      if (/\bvantage\s+volante\b/i.test(combined)) {
        trimPackage = "Vantage Volante";
      } else if (/\bvantage\b/i.test(combined)) {
        trimPackage = "Vantage";
      } else if (/\bvolante\b/i.test(combined)) {
        trimPackage = "Volante";
      }
    }

    if (/\bshooting\s+brake\b/i.test(combined)) {
      bodyStyleFacet = "Shooting Brake";
    } else if (/\bvolante\b|\bdrophead\b|\bconvertible\b/i.test(combined)) {
      bodyStyleFacet = "Convertible";
    } else if (/\bsports\s+saloon\b|\bcoup[eé]\b/i.test(combined)) {
      bodyStyleFacet = "Coupe";
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. FERRARI (250 GT, 275 GTB, 365 GTB/4 Daytona, Dino 246, 308, F355, Testarossa, F40, F50, Enzo)
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "ferrari") {
    if (/\b250\s*gto\b/i.test(combined)) {
      canonicalModel = "250 GTO";
      seriesCode = "250 GTO";
      bodyStyleFacet = "Coupe";
    } else if (/\b250\s*gt\b|\b250\s*gte\b/i.test(combined)) {
      canonicalModel = "250 GT";
      if (/\bswb\b|\bshort[-\s]?wheelbase\b/i.test(combined)) {
        seriesCode = "250 GT SWB";
        trimPackage = "SWB";
      } else if (/\blwb\b|\bcalifornia\s+spyder\b|\bcalifornia\s+spider\b/i.test(combined)) {
        seriesCode = "250 GT California";
        trimPackage = "California Spider";
        bodyStyleFacet = "Convertible";
      } else if (/\blusso\b/i.test(combined)) {
        seriesCode = "250 GT Lusso";
        trimPackage = "Lusso";
        bodyStyleFacet = "Coupe";
      } else if (/\btour\s+de\s+france\b|\btdf\b/i.test(combined)) {
        seriesCode = "250 GT TdF";
        trimPackage = "Tour de France";
        bodyStyleFacet = "Coupe";
      } else if (/\b250\s*gte\b/i.test(combined)) {
        seriesCode = "250 GTE 2+2";
        trimPackage = "2+2";
        bodyStyleFacet = "Coupe";
      } else if (/\bcabriolet\b/i.test(combined)) {
        seriesCode = "250 GT Cabriolet";
        bodyStyleFacet = "Convertible";
      } else {
        seriesCode = "250 GT";
      }
    } else if (/\b275\s*gt[bs](?:\/4)?\b/i.test(combined)) {
      if (/\b275\s*gtb\/4\b/i.test(combined)) {
        canonicalModel = "275 GTB/4";
        seriesCode = "275 GTB/4";
        trimPackage = "4-Cam";
        bodyStyleFacet = "Coupe";
      } else if (/\b275\s*gts\b/i.test(combined)) {
        canonicalModel = "275 GTS";
        seriesCode = "275 GTS";
        bodyStyleFacet = "Convertible";
      } else {
        canonicalModel = "275 GTB";
        seriesCode = "275 GTB";
        bodyStyleFacet = "Coupe";
      }
    } else if (/\b365\s*gt[bs]\/4\b|\bdaytona\b/i.test(combined)) {
      if (/\b365\s*gts\/4\b|\bdaytona\s+sp[iy]der\b/i.test(combined)) {
        canonicalModel = "365 GTS/4 Daytona";
        seriesCode = "365 GTS/4 Daytona";
        trimPackage = "Daytona Spider";
        bodyStyleFacet = "Convertible";
      } else {
        canonicalModel = "365 GTB/4 Daytona";
        seriesCode = "365 GTB/4 Daytona";
        trimPackage = "Daytona";
        bodyStyleFacet = "Coupe";
      }
    } else if (/\bdino\s*246\b|\b246\s*gt[s]?\b/i.test(combined)) {
      canonicalModel = "Dino 246";
      if (/\b246\s*gts\b/i.test(combined)) {
        seriesCode = "Dino 246 GTS";
        trimPackage = "GTS";
        bodyStyleFacet = "Targa";
      } else {
        seriesCode = "Dino 246 GT";
        trimPackage = "GT";
        bodyStyleFacet = "Coupe";
      }
    } else if (/\b308\s*gt[bs]\b/i.test(combined)) {
      canonicalModel = "308";
      const isGts = /\b308\s*gts\b/i.test(combined);
      seriesCode = isGts ? "308 GTS" : "308 GTB";
      if (/\bquattrovalvole\b|\bqv\b/i.test(combined)) trimPackage = "Quattrovalvole";
      else if (/\bvetroresina\b|\bfiberglass\b/i.test(combined)) trimPackage = "Vetroresina";
      bodyStyleFacet = isGts ? "Targa" : "Coupe";
    } else if (/\bf355\b/i.test(combined)) {
      canonicalModel = "F355";
      if (/\bspider\b/i.test(combined)) {
        seriesCode = "F355 Spider";
        bodyStyleFacet = "Convertible";
      } else if (/\bgts\b/i.test(combined)) {
        seriesCode = "F355 GTS";
        bodyStyleFacet = "Targa";
      } else {
        seriesCode = "F355 Berlinetta";
        bodyStyleFacet = "Coupe";
      }
    } else if (/\b(f40|f50|enzo|laferrari|testarossa|512\s*bb|512\s*bbi|512\s*tr|288\s*gto)\b/i.test(combined)) {
      const fm = combined.match(/\b(f40|f50|enzo|laferrari|testarossa|512\s*bbi|512\s*bb|512\s*tr|288\s*gto)\b/i);
      if (fm) {
        seriesCode = fm[1].replace(/\s+/g, " ").toUpperCase() === "TESTAROSSA"
          ? "Testarossa"
          : fm[1].replace(/\s+/g, " ").toUpperCase() === "ENZO"
          ? "Enzo"
          : fm[1].replace(/\s+/g, " ").toUpperCase() === "LAFERRARI"
          ? "LaFerrari"
          : fm[1].replace(/\s+/g, " ").toUpperCase();
        canonicalModel = seriesCode;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 11. TOYOTA LAND CRUISER & BMW M3 / 507
  // ══════════════════════════════════════════════════════════════════════════
  if (makeLower === "toyota" && /\b(?:land\s+cruiser|fj40|fj43|fj45|fj55|fj60|fj62|fj80)\b/i.test(combined)) {
    canonicalModel = "Land Cruiser";
    const fj = combined.match(/\b(fj40|fj43|fj45|fj55|fj60|fj62|fj80|bj40)\b/i);
    if (fj) {
      seriesCode = fj[1].toUpperCase();
    }
    drivetrainHint = "4WD";
    bodyStyleFacet = /\bpickup\b|\bfj45\b/i.test(combined) && /\bpickup\b/i.test(combined) ? "Pickup" : "SUV";
  }

  if (makeLower === "bmw") {
    if (/\bm3\b/i.test(combined)) {
      canonicalModel = "M3";
      if (/\be30\b/i.test(combined) || (year && year >= 1986 && year <= 1991)) {
        seriesCode = "E30 M3";
      } else if (/\be36\b/i.test(combined) || (year && year >= 1992 && year <= 1999)) {
        seriesCode = "E36 M3";
      } else if (/\be46\b/i.test(combined) || (year && year >= 2000 && year <= 2006)) {
        seriesCode = "E46 M3";
      }
      if (/\bsport\s+evolution\b/i.test(combined)) trimPackage = "Sport Evolution";
      else if (/\blightweight\b|\bltw\b/i.test(combined)) trimPackage = "Lightweight";
      else if (/\bcsl\b/i.test(combined)) trimPackage = "CSL";
      else if (/\bcompetition\b/i.test(combined)) trimPackage = "Competition";
    } else if (/\b507\b/i.test(combined)) {
      canonicalModel = "507";
      seriesCode = /\bseries\s*(?:ii|2)\b/i.test(combined) ? "507 Series II" : "507";
      bodyStyleFacet = "Roadster";
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 12. GENERAL BODY STYLE FALLBACK (All Makes)
  // ══════════════════════════════════════════════════════════════════════════
  if (!bodyStyleFacet) {
    bodyStyleFacet = extractGeneralBodyStyle(combined, input.bodyStyleHint);
  }

  // ── General Drivetrain Hint Fallback ────────────────────────────────────
  if (!drivetrainHint) {
    if (/\b(?:4x4|4wd|four[-\s]?wheel[-\s]?drive)\b/i.test(combined)) {
      drivetrainHint = "4WD";
    } else if (/\b2wd\b/i.test(combined)) {
      drivetrainHint = "2WD";
    }
  }

  return {
    canonical_model: canonicalModel,
    series_code: seriesCode,
    trim_package: trimPackage,
    body_style_facet: bodyStyleFacet,
    drivetrain_hint: drivetrainHint,
    bed_length: bedLength,
    cab_style: cabStyle,
    build_kind: buildKind,
  };
}

/**
 * Alias for backwards compatibility with Barrett-Jackson callers.
 */
export const extractBarrettJacksonVehicleFacets = extractVehicleFacets;

function matchGmCkSeries(text: string): { series: string; drivetrain: "2WD" | "4WD" } | null {
  const m = text.match(/\b([ckrv])[-\s/]?(10|15|20|25|30|35|1500|2500|3500)\b/i);
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const num = m[2];
  const series = `${prefix}${num}`;
  const drivetrain: "2WD" | "4WD" = prefix === "K" || prefix === "V" ? "4WD" : "2WD";
  return { series, drivetrain };
}

function matchGmEarlyTruckSeries(text: string, year: number | null): string | null {
  if (/\bcameo\b/i.test(text)) return "Cameo Carrier";
  if (/\bapache\b/i.test(text)) {
    const sub = text.match(/\b(3100|3200|3600|3800|10|20|30)\b/);
    return sub ? `Apache ${sub[1]}` : "Apache";
  }
  const numMatch = text.match(/\b(3100|3200|3600|3800|100|150|250)\b/);
  if (numMatch) {
    const code = numMatch[1];
    if (code === "100" || code === "150" || code === "250") {
      if (year && year >= 1947 && year <= 1959 && /\b(?:pickup|truck|stepside|fleetside)\b/i.test(text)) {
        return code;
      }
      return null;
    }
    return code;
  }
  return null;
}

function matchGmTruckTrim(text: string): string | null {
  if (/\bcheyenne\s+super\b/i.test(text)) return "Cheyenne Super";
  if (/\bsierra\s+classic\b/i.test(text)) return "Sierra Classic";
  if (/\bsierra\s+grande\b/i.test(text)) return "Sierra Grande";
  if (/\bhigh\s+sierra\b/i.test(text)) return "High Sierra";
  if (/\bgentleman\s+jim\b/i.test(text)) return "Gentleman Jim";
  if (/\bsilverado\b/i.test(text)) return "Silverado";
  if (/\bcheyenne\b/i.test(text)) return "Cheyenne";
  if (/\bscottsdale\b/i.test(text)) return "Scottsdale";
  if (/\bcustom\s+sport\s+truck\b|\bcst\b/i.test(text)) return "CST";
  if (/\bcustom\s+deluxe\b/i.test(text)) return "Custom Deluxe";
  if (/\bbig\s*10\b/i.test(text)) return "Big 10";
  if (/\bindy\s+hauler\b|\bindy\s+pace\s+truck\b/i.test(text)) return "Indy Hauler";
  if (/\bchalet\b/i.test(text)) return "Chalet";
  if (/\b454\s+ss\b/i.test(text)) return "454 SS";
  if (/\bsyT?clone\b/i.test(text)) return "Syclone";
  if (/\btyphoon\b/i.test(text)) return "Typhoon";
  return null;
}

/**
 * Extracts a canonical collector body style from headline/model text,
 * carefully checking multi-word British/European body styles ("Drophead Coupé",
 * "Fixed-Head Coupé", "Shooting Brake", "Sports Saloon", "Gullwing") BEFORE
 * generic single-word substrings so "Drophead Coupé" maps to "Convertible"
 * rather than "Coupe".
 */
export function extractGeneralBodyStyle(text: string, hint?: string | null): string | null {
  const combined = `${text} ${hint || ""}`.trim();
  if (/\bsplit[-\s]?window\b/i.test(combined)) return "Split-Window Coupe";
  if (/\bgullwing\b/i.test(combined)) return "Gullwing Coupe";
  if (/\bstepside\b/i.test(combined)) return "Stepside";
  if (/\bflareside\b/i.test(combined)) return "Flareside";
  if (/\bfleetside\b/i.test(combined)) return "Fleetside";
  if (/\bstyleside\b/i.test(combined)) return "Styleside";
  if (/\bsweptline\b/i.test(combined)) return "Sweptline";
  if (/\bhalf[-\s]?cab\b/i.test(combined)) return "Half-Cab";
  if (/\bcrew[-\s]?cab\b/i.test(combined)) return "Crew Cab";
  if (/\bshort[-\s]?bed\b/i.test(combined) && /\b(?:pickup|truck)\b/i.test(combined)) return "Short Bed";
  if (/\blong[-\s]?bed\b/i.test(combined) && /\b(?:pickup|truck)\b/i.test(combined)) return "Long Bed";
  if (/\bt[-\s]?top\b/i.test(combined)) return "T-Top";
  if (/\btarga\b/i.test(combined)) return "Targa";
  if (/\bshooting\s+brake\b/i.test(combined)) return "Shooting Brake";
  // Must check Drophead Coupé / Drophead BEFORE generic Coupé/Coupe!
  if (/\b(?:drophead\s+coup[eé]|drop[-\s]?head\s+coup[eé]|drophead|dhc|convertible|cabriolet|volante|phaeton|sp[iy]der)\b/i.test(combined)) {
    return "Convertible";
  }
  if (/\b(?:roadster|speedster|barchetta|torpedo|tourer|open\s+two[-\s]?seater|runabout)\b/i.test(combined)) {
    return "Roadster";
  }
  if (/\b(?:fastback|sportsroof)\b/i.test(combined)) return "Fastback";
  if (/\b(?:2[-\s]?door\s+hardtop|sport\s+coupe)\b/i.test(combined)) return "2-Door Hardtop";
  if (/\b4[-\s]?door\s+hardtop\b/i.test(combined)) return "4-Door Hardtop";
  if (/\bhardtop\b/i.test(combined)) return "Hardtop";
  if (/\b(?:fixed[-\s]?head\s+coup[eé]|fhc|berlinetta|sports\s+saloon|coup[eé])\b/i.test(combined)) {
    return "Coupe";
  }
  if (/\b(?:station\s+wagon|estate\s+wagon|country\s+squire|town\s+&\s+country|woody\s+wagon|nomad|wagon|giardinetta|kombi)\b/i.test(combined)) {
    return "Wagon";
  }
  if (/\b(?:sedan|saloon|berlina|4[-\s]?door)\b/i.test(combined)) return "Sedan";
  if (/\b(?:landaulet|limousine)\b/i.test(combined)) return "Limousine";
  if (/\b(?:panel\s+truck|panel\s+delivery|sedan\s+delivery)\b/i.test(combined)) return "Panel";
  if (/\b(?:pickup|truck)\b/i.test(combined)) return "Pickup";
  if (/\b(?:suv|sport\s+utility|blazer|bronco|scout|jimmy|tahoe|yukon|suburban|land\s+cruiser|defender)\b/i.test(combined)) return "SUV";
  if (/\b(?:van|microbus|transporter|kombi\s+van)\b/i.test(combined)) return "Van";
  return null;
}
