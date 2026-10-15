// Bonhams lot titles ("1966 Ferrari 330 GT Chassis no. 8023 Engine no. 8023") split into year, make, model and chassis.
// Tested in titleParse.test.ts.

// ─── Known multi-word makes for title parsing ─────────────────────────────────

const KNOWN_MAKES = [
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
];

// ─── Title parser: "1966 Ferrari 330 GT Chassis no. 8023 Engine no. 8023" ─────

export interface ParsedTitle {
  year: number | null;
  make: string | null;
  model: string | null;
  chassis: string | null;
  /** "1965-2016" when the title leads with a year range. */
  year_range?: string;
  /** A claim that stood ahead of the car in the title ("58,000 kms from new"). */
  blurb?: string;
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

  // A claim ahead of the car ("58,000 kms from new,1976 Ferrari 308GTB", "1 of only 70 built,1963 Aston Martin DB4"): the car starts at the
  // first ", YYYY " within the first 60 characters; the claim is kept as blurb, not read as the make or the year.
  if (!/^\d{4}\s*[\/\u2013\u2014-]?\s*\d{0,4}\s/.test(clean)) {
    const lead = clean.slice(0, 60).match(/^(.{3,58}?),\s*(\d{4})\s+(?=[A-Za-z])/);
    if (lead && parseInt(lead[2], 10) >= 1886 && parseInt(lead[2], 10) <= 2030) {
      result.blurb = lead[1].trim();
      clean = clean.slice(lead[0].length - lead[2].length - 1).trim();
    }
  }

  // Year: leading 4-digit year (1886-2030), or a leading range ("1965/2016 Shelby Cobra", "1960-2000 Aston Martin"): the first year of
  // a range names the car, and the range is kept as year_range because the second year is a later build or conversion.
  const rangeMatch = clean.match(/^(\d{4})\s*[\/\u2013\u2014-]\s*(\d{2}|\d{4})\s+/);
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
  const yearMatch = result.year ? null : clean.match(/^(\d{4})\s+/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    if (y >= 1886 && y <= 2030) {
      result.year = y;
      clean = clean.slice(yearMatch[0].length).trim();
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
  const lowerClean = clean.toLowerCase();
  let foundMake: string | null = null;
  for (const make of KNOWN_MAKES) {
    if (lowerClean.startsWith(make.toLowerCase())) {
      foundMake = make;
      clean = clean.slice(make.length).trim();
      break;
    }
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

  // Model: everything remaining (strip trailing punctuation)
  if (clean.length > 0) {
    result.model = clean.replace(/[,;]+$/, "").trim() || null;
  }

  return result;
}

