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

  // Year: leading 4-digit year (1886-2030)
  const yearMatch = clean.match(/^(\d{4})\s+/);
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

