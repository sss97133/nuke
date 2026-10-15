// Bonhams lot titles ("1966 Ferrari 330 GT Chassis no. 8023 Engine no. 8023") split into year, make, model and chassis.
// Tested in titleParse.test.ts.

// ─── Known multi-word makes for title parsing ─────────────────────────────────

export const KNOWN_MAKES = [
  "Alfa Romeo", "Aston Martin", "Austin-Healey", "Mercedes-Benz", "Rolls-Royce",
  "Land Rover", "De Tomaso", "Facel Vega", "Hispano-Suiza", "Brough Superior",
  "Pierce-Arrow", "De Dion-Bouton", "Isotta Fraschini", "Invicta",
  "AC", "BMW", "Bentley", "Bugatti", "Cadillac", "Chevrolet", "Chrysler",
  "Citroën", "Daimler", "Delage", "Delahaye", "Dodge", "Ferrari", "Fiat",
  "Ford", "Jaguar", "Jensen", "Lamborghini", "Lancia", "Lincoln", "Lotus",
  "Maserati", "McLaren", "MG", "Morgan", "Oldsmobile", "Packard", "Peugeot",
  "Plymouth", "Pontiac", "Porsche", "Renault", "Riley", "Rover", "Shelby",
  "Singer", "Studebaker", "Sunbeam", "Talbot", "Toyota", "Triumph",
  "TVR", "Vauxhall", "Volvo", "Volkswagen",
  // canonical_makes display names the list lacked, and makes that turn up in catalogue headlines
  "GMC", "Jeep", "Honda", "Nissan", "Subaru", "Buick", "International", "Audi", "Mercury", "Mazda", "Lexus", "AMC", "Mitsubishi", "Datsun",
  "Willys", "Acura", "Suzuki", "Isuzu", "Saturn", "Yamaha", "Morris", "Tesla", "Mini", "Ducati", "Nash", "Citroen", "Hudson", "Auburn",
  "Kawasaki", "Opel", "Saab", "DeLorean", "Cord", "Duesenberg", "Tucker", "Harley-Davidson", "Indian", "Austin", "DeSoto", "Edsel", "Ariel",
  "Pagani", "BSA", "Holden", "Imperial", "Koenigsegg", "Maybach", "Messerschmitt", "Norton", "LaSalle", "Stutz", "Rambler", "Crosley", "Saleen",
  "Smart", "Alvis", "Armstrong Siddeley", "Lagonda", "Hillman", "Humber", "Wolseley", "Napier", "Minerva", "Hotchkiss", "Panhard", "Lanchester",
  "Healey", "Allard", "Jowett", "Vincent", "Velocette", "Matchless", "Royal Enfield", "Triumph", "Frazer Nash", "Frazer-Nash", "Bristol", "Lola", "Cooper",
  "Brabham", "Williams", "Pilbeam", "Ginetta", "Marcos", "Reliant", "Bond", "Trojan", "Swallow", "Standard", "Lea-Francis", "Sunbeam-Talbot", "Simca",
  "Ligier", "Matra", "Tatra", "Skoda", "Zagato", "Abarth", "Autobianchi", "Innocenti", "Iso", "Bizzarrini", "Ferrari", "Mercedes", "Benz", "Horch",
  "Maxwell", "Winton", "Thornycroft", "Dennis", "Argyll", "Arrol-Johnston", "Star", "Clement-Talbot", "Spyker", "Rambler", "Hispano Suiza",
  "Stanley", "Locomobile", "White", "Kissel", "Amilcar", "Simplex", "Fitch", "DRA", "CGV", "De Dion-Bouton", "De Dion Bouton", "Tyrrell", "Benetton",
  "Ensign", "March", "Toj", "Lynx", "Walker", "Lister", "Elva", "Chevron", "Alpine", "Bitter", "Mors", "De Dietrich", "Georges Richard", "Grinnall", "Merryweather", "Gardner-Serpollet", "Cunningham", "Diva", "Kincraft", "Greenwood", "AMG", "Group 44", "SS", "Gulf Mirage",
  "Delaunay-Belleville", "Berliet", "Darracq", "Sizaire", "Lorraine-Dietrich",
];

/** Catalogue spellings that name a make on KNOWN_MAKES under its full name. */
const MAKE_ALIASES: Record<string, string> = { mercedes: "Mercedes-Benz", benz: "Benz", "frazer-nash": "Frazer Nash", "hispano suiza": "Hispano-Suiza", citroen: "Citroën" };

// Longest first, so "Rolls-Royce" is not read as "Rolls" and "Austin-Healey" not as "Austin".
const MAKES_BY_LENGTH = [...new Set(KNOWN_MAKES)].sort((a, b) => b.length - a.length);
const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MAKE_ALT = MAKES_BY_LENGTH.map((m) => escapeRe(m).replace(/[ -]/g, "[ -]")).join("|");
const MAKE_AT_START = new RegExp(`^(${MAKE_ALT})(?![A-Za-z0-9])`, "i");
const makeKey = (t: string) => t.toLowerCase().replace(/[ -]+/g, " ");
// Spelling in the title -> the list's spelling ("Rolls Royce" -> "Rolls-Royce").
const MAKE_CANON = new Map(MAKES_BY_LENGTH.map((m) => [makeKey(m), m] as const));
// A year, optionally a range, then a make: the start of the car line. A headline can run into the year with no separator ("campaigned1960 Aston Martin").
const CAR_LINE_RE = new RegExp(`(\\d{4})(?:\\s*[/\u2013\u2014-]\\s*(\\d{2,4}))?\\s*[\u2013\u2014-]?\\s*[\\s'\u2018\u2019"\u201c]*(?=(?:${MAKE_ALT})(?![A-Za-z0-9]))`, "gi");

// ─── Title parser: "1966 Ferrari 330 GT Chassis no. 8023 Engine no. 8023" ─────

export interface ParsedTitle {
  year: number | null;
  make: string | null;
  model: string | null;
  chassis: string | null;
  /** "1965-2016" when the title leads with a year range. */
  year_range?: string;
  /** A claim or headline that stood ahead of the car in the title ("58,000 kms from new", "The ex-Barry Sheene"). */
  blurb?: string;
  /** The range after the year came from a headline-led title: the year is left null. */
  headline_year_range?: boolean;
}

export function parseTitle(title: string): ParsedTitle {
  const result: ParsedTitle = { year: null, make: null, model: null, chassis: null };
  if (!title) return result;

  // Extract chassis/VIN from title
  // Patterns: "Chassis no. XXXXX", "Chassis no XXXXX", "VIN XXXXX"
  const chassisPatterns = [
    /Chassis\s+no\.?\s+([A-Z0-9*][A-Z0-9*./-]*)/i,
    /VIN[:\s]+([A-HJ-NPR-Z0-9]{17})/i,
    /Frame\s+no\.?\s+([A-Z0-9*][A-Z0-9*./-]*)/i,
  ];
  for (const pat of chassisPatterns) {
    const m = title.match(pat);
    if (m) {
      result.chassis = m[1].trim().replace(/[./-]+$/, "").toUpperCase();
      break;
    }
  }

  // Strip chassis/engine suffixes for cleaner parsing
  let clean = title
    .replace(/\s*Chassis\s+no\.?\s+.*/i, "")
    .replace(/\s*Engine\s+no\.?\s+.*/i, "")
    .replace(/\s*Frame\s+no\.?\s+.*/i, "")
    .replace(/\s*VIN[:\s]+.*/i, "")
    .trim();

  // A headline ahead of the car ("The ex-Peter Thornton, Ian Dalglish actively and successfully campaigned,1960 Aston Martin DB4 GT", "Ex-Charles
  // Pozzi 1952 FERRARI 212 EUROPA"): the car line starts at the first year from 1885 to 2026 that stands directly before a known make. The headline
  // is kept as blurb (provenance), not read as the make. A range after the year ("1959-61") is kept as year_range and the year left null.
  if (!/^\d{4}\s*[\/\u2013\u2014-]?\s*\d{0,4}\s/.test(clean)) {
    for (const m of clean.matchAll(CAR_LINE_RE)) {
      const y = parseInt(m[1], 10);
      if (y < 1885 || y > 2026 || m.index === 0) continue;
      const head = clean.slice(0, m.index).replace(/[\s,;:\u2013\u2014-]+$/, "").trim();
      if (head.length < 3) continue;
      result.blurb = head;
      if (m[2]) {
        result.year_range = `${m[1]}-${m[2]}`;
        clean = clean.slice(m.index + m[0].length).trim();
        result.headline_year_range = true;
      } else {
        clean = clean.slice(m.index).trim();
      }
      break;
    }
    // No known make after any year: a headline then a comma, or a word glued to the year ("Louis Roderer, Reims,1904 CGV 6\u00bc-Litre").
    if (!result.blurb) {
      const lead = clean.slice(0, 160).match(/^(.{3,158}?)(?:,\s*|(?<=[a-z]))(\d{4})(?:\s*[\/\u2013\u2014-]\s*(\d{2,4}))?\s+(?=[A-Za-z0-9'\u2018"])/);
      if (lead && parseInt(lead[2], 10) >= 1886 && parseInt(lead[2], 10) <= 2030) {
        result.blurb = lead[1].trim();
        if (lead[3]) {
          result.year_range = `${lead[2]}-${lead[3]}`;
          result.headline_year_range = true;
          clean = clean.slice(lead[0].length).trim();
        } else {
          clean = clean.slice(lead[0].length - lead[2].length - 1).trim();
        }
      }
    }
    // A headline with no comma and a make the list lacks ("From the Robert Ullrich Collection 1908 Stanley Model K"): the car line starts at the last
    // year that is followed by a word, unless the title itself opens with a known make.
    if (!result.blurb && !new RegExp(`^(?:${MAKE_ALT})(?![A-Za-z0-9])`, "i").test(clean)) {
      const years = [...clean.matchAll(/(?<![\d,.\/-])(\d{4})\s+(?=[A-Za-z'\u2018"])/g)].filter((m) => parseInt(m[1], 10) >= 1885 && parseInt(m[1], 10) <= 2026);
      const last = years.length === 1 ? years[0] : undefined;
      if (last && last.index !== undefined && last.index >= 3) {
        result.blurb = clean.slice(0, last.index).replace(/[\s,;:\u2013\u2014-]+$/, "").trim();
        clean = clean.slice(last.index).trim();
      }
    }
    // A headline then a comma then the car with no year at all ("The ex-Innes Ireland,Lancia Fulvia HF").
    if (!result.blurb) {
      const cm = clean.slice(0, 160).match(new RegExp(`^(.{3,158}?),\\s*(?=(?:${MAKE_ALT})(?![A-Za-z0-9]))`, "i"));
      if (cm) {
        result.blurb = cm[1].trim();
        clean = clean.slice(cm[0].length).trim();
      }
    }
  }

  // Year: leading 4-digit year (1886-2030), or a leading range ("1965/2016 Shelby Cobra", "1960-2000 Aston Martin"): the first year of
  // a range names the car, and the range is kept as year_range because the second year is a later build or conversion.
  // "1964\u00bd Ford Mustang" is a 1964 car; "1937/8 Buick" a 1937-38 one; "1952,Allard" a comma where the space should be.
  const short = result.year || result.headline_year_range ? null : clean.match(/^(\d{4})(?:\u00bd|\/(\d))?[\s,]+(?=[A-Za-z])/);
  if (short && parseInt(short[1], 10) >= 1886 && parseInt(short[1], 10) <= 2030) {
    result.year = parseInt(short[1], 10);
    if (short[2]) result.year_range = `${short[1]}-${short[1].slice(0, 3)}${short[2]}`;
    clean = clean.slice(short[0].length).trim();
  }
  // "1969-type McLaren M12" is a car in the style of 1969, not a 1969 car; "1790 Ferrari" is a typo. Neither gives a year.
  const typeLead = result.year ? null : clean.match(new RegExp(`^\\d{4}(?:-type)?\\s+(?=(?:${MAKE_ALT})(?![A-Za-z0-9]))`, "i"));
  if (typeLead) clean = clean.slice(typeLead[0].length).trim();
  const rangeMatch = result.year || result.headline_year_range ? null : clean.match(/^(\d{4})\s*[\/\u2013\u2014-]\s*(\d{2}|\d{4})\s+/);
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    // "1954-55": two digits read in the first year's century
    const b = rangeMatch[2].length === 2 ? parseInt(rangeMatch[1].slice(0, 2) + rangeMatch[2], 10) : parseInt(rangeMatch[2], 10);
    if (a >= 1886 && b >= a && b <= 2030) {
      result.year = a;
      result.year_range = `${a}-${b}`;
      clean = clean.slice(rangeMatch[0].length).trim();
    }
  }
  const yearMatch = result.year || result.headline_year_range ? null : clean.match(/^(\d{4})\s+/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    if (y >= 1886 && y <= 2030) {
      result.year = y;
      clean = clean.slice(yearMatch[0].length).trim();
    }
  }
  // Older catalogue titles end with the year ("Mercedes-Benz 280 SL cabriolet avec hardtop 1969", "Minerva modele CC 38 HP tourer 1912").
  if (!result.year) {
    const tail = clean.match(/\s+(?:c\.?\s*)?(\d{4})\s*$/i);
    if (tail) {
      const y = parseInt(tail[1], 10);
      if (y >= 1886 && y <= 2030) {
        result.year = y;
        clean = clean.slice(0, clean.length - tail[0].length).trim();
      }
    }
  }
  // Fallback: "c.1960" or "Circa 1960"
  if (!result.year) {
    const circaMatch = clean.match(/(?:c\.?\s*|circa\s+)(\d{4})/i);
    if (circaMatch) {
      const y = parseInt(circaMatch[1], 10);
      if (y >= 1886 && y <= 2030) {
        result.year = y;
        clean = clean.replace(circaMatch[0], "").trim();
      }
    }
  }

  // A separator between the year and the make ("1970 – Lamborghini Espada SII") is not part of the make.
  clean = clean.replace(/^[\s\u2013\u2014\-:,.]+/, "").trim();

  // Make: check multi-word makes first, then take first word
  // "2-litre Maserati 4 Cilindri": the engine size stands before the make and belongs with the model.
  const litre = clean.match(/^(\d+(?:\.\d+)?[- ]litre)\s+(?=[A-Za-z])/i);
  if (litre) clean = clean.slice(litre[0].length).trim();
  let foundMake: string | null = null;
  const atStart = clean.match(MAKE_AT_START);
  if (atStart) {
    const canon = MAKE_CANON.get(makeKey(atStart[1])) ?? atStart[1];
    foundMake = MAKE_ALIASES[canon.toLowerCase()] ?? canon;
    clean = clean.slice(atStart[1].length).replace(/^[\s-]+/, "");
  }
  // "MGB GT V8": the make is MG, the letter is the model's.
  const mg = foundMake ? null : clean.match(/^MG([ABCFT])\b\s*/i);
  if (mg) {
    foundMake = "MG";
    clean = `${mg[1].toUpperCase()} ${clean.slice(mg[0].length)}`.trim();
  }
  if (!foundMake && clean.length > 0) {
    // Hyphenated makes: "Harley-Davidson", unknown compound
    const firstWordMatch = clean.match(/^([A-Za-zÀ-ÿ][\w-]*(?:\s[A-Za-zÀ-ÿ][\w-]*)?)\s/);
    if (firstWordMatch) {
      foundMake = firstWordMatch[1];
      clean = clean.slice(firstWordMatch[0].length).trim();
    } else {
      foundMake = clean;
      clean = "";
    }
  }
  result.make = foundMake;
  if (litre) clean = clean ? `${litre[1]} ${clean}` : litre[1];

  // Model: everything remaining (strip trailing punctuation)
  if (clean.length > 0) {
    result.model = clean.replace(/[,;]+$/, "").trim() || null;
  }

  return result;
}

