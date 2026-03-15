/**
 * VIN Decoder for both modern (post-1981) and classic (pre-1981) VINs
 */

export interface VINDecodeResult {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  engine_size: string | null;
  displacement: number | null;
  transmission: string | null;
  drivetrain: string | null;
  body_style: string | null;
  manufacturer: string | null;
  plant: string | null;
  serial_number: string | null;
  is_pre_1981: boolean;
}

/**
 * Decode a VIN (Vehicle Identification Number)
 * Handles both modern 17-character VINs (1981+) and classic VINs (pre-1981)
 */
export function decodeVin(vin: string): VINDecodeResult {
  const cleanVin = vin.toUpperCase().trim();
  
  const result: VINDecodeResult = {
    year: null,
    make: null,
    model: null,
    trim: null,
    engine_size: null,
    displacement: null,
    transmission: null,
    drivetrain: null,
    body_style: null,
    manufacturer: null,
    plant: null,
    serial_number: null,
    is_pre_1981: cleanVin.length < 17
  };

  // PRE-1981 VIN FORMAT (shorter, varied length)
  if (cleanVin.length < 17) {
    return decodePre1981Vin(cleanVin);
  }

  // POST-1981 VIN FORMAT (17 characters)
  if (cleanVin.length === 17) {
    return decodeModernVin(cleanVin);
  }

  return result;
}

/**
 * Pre-1981 GM year code decoder.
 * Works for both truck and passenger car VINs where year is a single digit.
 * Pattern: 0=1970, 1=1971, ..., 9=1969 (wraps from 60s)
 * For 1973-1980: 3=1973, 4=1974, ..., 0=1980
 */
function decodeGmYearDigit(yearChar: string): number | null {
  if (!/\d/.test(yearChar)) return null;
  const d = parseInt(yearChar, 10);
  // GM used modular year codes from ~1960-1980
  // 0=1960 or 1970 or 1980, 1=1961/1971, ..., 9=1969/1979
  // Without external context, return 1970s decade (most common for collector vehicles)
  // Callers can adjust based on model knowledge
  if (d === 0) return 1970;
  if (d >= 1 && d <= 6) return 1970 + d; // 1=1971 .. 6=1976
  if (d >= 7 && d <= 9) return 1960 + d; // 7=1967 .. 9=1969
  return null;
}

/**
 * GM passenger car series codes (position 2 of pre-1981 VIN).
 * Division 1 (Chevrolet) series map for 1964-1980.
 *
 * Format (1968-1980): [Division][Series][BodyCode][YearDigit][Plant][Sequential]
 *   e.g. 136807Z130419 → 1=Chevy, 3=Camaro/Corvette, 68=body, 0=1970, 7=plant, Z130419=seq
 *
 * Note: Series "3" is ambiguous — used for both Camaro (body 37/87) and
 * low-price Chevelle. Corvette is series "9" from 1963-1967, then confirmed
 * by body codes 37/87 with specific sequential ranges for 1968+.
 * The Z-prefix Corvette sequential (Z100001+) disambiguates from Camaro.
 */
const GM_CHEVY_SERIES: Record<string, { model: string; body_style?: string }> = {
  '1': { model: 'Chevrolet' },   // Full-size (Biscayne/Bel Air/Impala base)
  '2': { model: 'Nova' },        // Chevy II / Nova (1962-1979)
  '3': { model: 'Camaro' },      // Camaro (1967+); Corvette distinguished by Z-prefix seq
  '4': { model: 'Chevelle' },    // Chevelle / Malibu (1964-1977)
  '5': { model: 'Impala' },      // Impala (mid-range)
  '6': { model: 'Caprice' },     // Caprice / full-size upper
  '7': { model: 'Monte Carlo' }, // Monte Carlo (1970+)
  '8': { model: 'Chevelle' },    // Chevelle / El Camino (some years)
  '9': { model: 'Corvette' },    // Corvette (series 9 is definitive, all years)
};

/**
 * GM Chevrolet body style codes (positions 3-4 of pre-1981 VIN)
 */
const GM_CHEVY_BODY_CODES: Record<string, string> = {
  '11': 'Sedan',       // 2-door sedan
  '17': 'Coupe',       // 2-door coupe
  '19': 'Sedan',       // 4-door sedan
  '27': 'Coupe',       // 2-door coupe (Camaro/Nova)
  '35': 'Wagon',       // 4-door wagon
  '36': 'Wagon',       // 4-door wagon
  '37': 'Coupe',       // 2-door sport coupe (Corvette Stingray / Camaro)
  '39': 'Sedan',       // 4-door sedan
  '47': 'Coupe',       // 2-door hardtop coupe
  '57': 'Coupe',       // 2-door hardtop
  '67': 'Convertible', // 2-door convertible
  '68': 'Convertible', // Corvette convertible (some year/series combos)
  '69': 'Sedan',       // 4-door hardtop
  '80': 'Pickup',      // El Camino
  '87': 'Coupe',       // 2-door coupe (Camaro/Corvette T-top)
};

/**
 * Detect if a GM VIN serial number indicates a Corvette.
 * Corvette sequentials 1968-1982 start at specific ranges and plants.
 * Plant code 'S' = St. Louis (exclusive Corvette 1968-1981)
 * Plant code '5' = Bowling Green (1981-onwards Corvette)
 * Sequential often has Z-prefix pattern or starts at 400001.
 */
function isCorvetteSequential(vin: string, seriesCode: string): boolean {
  // Series 9 is definitively Corvette (1963-1967)
  if (seriesCode === '9') return true;

  // For series 3 (ambiguous), check plant code and sequential
  if (seriesCode === '3') {
    const plantCode = vin.charAt(5); // For 1968-1972 format where plant is after year
    // St. Louis plant was Corvette-exclusive
    if (plantCode === 'S') return true;
    // Check for Z-prefix in sequential (characteristic of Corvette production)
    const seqPart = vin.substring(6);
    if (seqPart.startsWith('Z') || seqPart.startsWith('S')) return true;
    // Body codes 37 and 87 with high sequentials are often Corvette
    const bodyCode = vin.substring(2, 4);
    if ((bodyCode === '37' || bodyCode === '67') && /[4-9]\d{5}/.test(seqPart)) return true;
  }

  return false;
}

/**
 * Decode pre-1981 VIN.
 *
 * Handles:
 * - GM trucks (prefix C=Chevrolet, T=GMC): 1967-1980
 * - GM passenger cars (prefix 1=Chevrolet, 2=Pontiac, 3=Oldsmobile, 4=Buick, 6=Cadillac): 1964-1980
 *   Includes Corvette, Camaro, Chevelle, Nova, Impala, etc.
 * - Ford (prefix F): basic make identification only
 */
function decodePre1981Vin(vin: string): VINDecodeResult {
  const result: VINDecodeResult = {
    year: null,
    make: null,
    model: null,
    trim: null,
    engine_size: null,
    displacement: null,
    transmission: null,
    drivetrain: null,
    body_style: null,
    manufacturer: null,
    plant: null,
    serial_number: null,
    is_pre_1981: true
  };

  // ── GM Truck VIN (1967-1980) ────────────────────────────────────────
  // Format: [Div][Engine][Series2][Body][Year][Plant][Seq]
  // e.g. CE1418647123 → C=Chevy Truck, E=V8, 14=C10, 1=Pickup, 8=1968, 6=plant
  if ((vin.startsWith('C') || vin.startsWith('T')) && vin.length >= 10) {
    result.manufacturer = 'General Motors';

    const divisionCode = vin.charAt(0);
    if (divisionCode === 'C') {
      result.make = 'Chevrolet';
    } else if (divisionCode === 'T') {
      result.make = 'GMC';
    }

    const engineCode = vin.charAt(1);
    if (engineCode === 'E') {
      result.engine_size = 'V8';
    } else if (engineCode === 'S') {
      result.engine_size = 'I6';
    }

    const seriesCode = vin.substring(2, 4);
    if (seriesCode === '14') {
      result.model = 'C10';
      result.body_style = 'Pickup';
    } else if (seriesCode === '24') {
      result.model = 'C20';
      result.body_style = 'Pickup';
    } else if (seriesCode === '34') {
      result.model = 'C30';
      result.body_style = 'Pickup';
    }

    const bodyCode = vin.charAt(4);
    if (bodyCode === '4') {
      result.body_style = 'Pickup';
    } else if (bodyCode === '3') {
      result.body_style = 'Cab & Chassis';
    } else if (bodyCode === '6') {
      result.body_style = 'Suburban';
    } else if (bodyCode === '8') {
      result.body_style = 'Blazer';
    }

    result.year = decodeGmYearDigit(vin.charAt(5));
    result.serial_number = vin.substring(6);
  }

  // ── GM Passenger Car VIN (1964-1980) ────────────────────────────────
  // Format: [Division][Series][BodyCode2][YearDigit][PlantCode][Sequential]
  // Division: 1=Chevrolet, 2=Pontiac, 3=Oldsmobile, 4=Buick, 6=Cadillac
  // e.g. 136807Z130419 → 1=Chevy, 3=Camaro/Corvette, 68=body, 0=1970, 7=plant
  // e.g. 194675S100001 → 1=Chevy, 9=Corvette, 46=body, 7=1967, 5=plant
  else if (/^[12346]/.test(vin) && vin.length >= 10 && vin.length <= 13) {
    result.manufacturer = 'General Motors';

    const divisionCode = vin.charAt(0);
    switch (divisionCode) {
      case '1': result.make = 'Chevrolet'; break;
      case '2': result.make = 'Pontiac'; break;
      case '3': result.make = 'Oldsmobile'; break;
      case '4': result.make = 'Buick'; break;
      case '6': result.make = 'Cadillac'; break;
    }

    // Series code (position 2) — Chevrolet-specific model decode
    if (divisionCode === '1') {
      const seriesCode = vin.charAt(1);
      const bodyCode = vin.substring(2, 4);

      // Check Corvette first (series 9, or series 3 with Corvette indicators)
      if (isCorvetteSequential(vin, seriesCode)) {
        result.model = 'Corvette';
        if (bodyCode === '67') result.body_style = 'Convertible';
        else if (bodyCode === '37' || bodyCode === '87') result.body_style = 'Coupe';
      } else if (GM_CHEVY_SERIES[seriesCode]) {
        result.model = GM_CHEVY_SERIES[seriesCode].model;
        if (GM_CHEVY_SERIES[seriesCode].body_style) {
          result.body_style = GM_CHEVY_SERIES[seriesCode].body_style!;
        }
      }

      // Body style from body code (if not already set by series/Corvette check)
      if (!result.body_style && GM_CHEVY_BODY_CODES[bodyCode]) {
        result.body_style = GM_CHEVY_BODY_CODES[bodyCode];
      }
    }

    // Year (position 5 for all GM passenger cars)
    result.year = decodeGmYearDigit(vin.charAt(4));

    // Plant code (position 6)
    result.plant = vin.charAt(5);

    // Sequential number
    result.serial_number = vin.substring(6);
  }

  // ── Ford pre-1981 ───────────────────────────────────────────────────
  else if (vin.startsWith('F')) {
    result.manufacturer = 'Ford Motor Company';
    result.make = 'Ford';
  }

  // ── Mopar pre-1981 ─────────────────────────────────────────────────
  // Chrysler/Plymouth/Dodge used letter prefixes
  else if (/^[BDELPRSVW]/.test(vin) && vin.length >= 10 && vin.length <= 13) {
    // Common Mopar division prefixes
    const moparDivisions: Record<string, string> = {
      'B': 'Plymouth', // Barracuda era
      'D': 'Dodge',
      'E': 'Chrysler', // Imperial sometimes
      'L': 'Plymouth',
      'P': 'Plymouth',
      'R': 'Chrysler',
      'S': 'Dodge',    // sometimes
      'V': 'Plymouth', // Valiant
      'W': 'Dodge',    // some models
    };
    const firstChar = vin.charAt(0);
    if (moparDivisions[firstChar]) {
      result.manufacturer = 'Chrysler Corporation';
      result.make = moparDivisions[firstChar];
    }
  }

  return result;
}

/**
 * Decode modern 17-character VIN (1981+)
 */
function decodeModernVin(vin: string): VINDecodeResult {
  const result: VINDecodeResult = {
    year: null,
    make: null,
    model: null,
    trim: null,
    engine_size: null,
    displacement: null,
    transmission: null,
    drivetrain: null,
    body_style: null,
    manufacturer: null,
    plant: null,
    serial_number: null,
    is_pre_1981: false
  };

  // World Manufacturer Identifier (positions 1-3)
  const wmi = vin.substring(0, 3);
  
  // Manufacturer lookup — ordered longest-prefix-first for correct matching
  const manufacturerMap: [string, string, string | null][] = [
    // [prefix, manufacturer, make] — check 3-char before 2-char
    ['1GC', 'Chevrolet Truck', 'Chevrolet'],
    ['1GN', 'Chevrolet', 'Chevrolet'],
    ['1G1', 'Chevrolet', 'Chevrolet'],
    ['1G2', 'Pontiac', 'Pontiac'],
    ['1G3', 'Oldsmobile', 'Oldsmobile'],
    ['1G4', 'Buick', 'Buick'],
    ['1G6', 'Cadillac', 'Cadillac'],
    ['1G', 'General Motors', 'Chevrolet'], // fallback for unknown GM
    ['2G', 'General Motors Canada', 'Chevrolet'],
    ['3G', 'General Motors Mexico', 'Chevrolet'],
    ['1FT', 'Ford Truck', 'Ford'],
    ['1FA', 'Ford', 'Ford'],
    ['1FB', 'Ford', 'Ford'],
    ['1F', 'Ford', 'Ford'],
    ['2F', 'Ford Canada', 'Ford'],
    ['1J4', 'Jeep', 'Jeep'],
    ['1J8', 'Jeep', 'Jeep'],
    ['1J', 'Jeep', 'Jeep'],
    ['1C3', 'Chrysler', 'Chrysler'],
    ['1C4', 'Chrysler', 'Chrysler'],
    ['1C6', 'Dodge', 'Dodge'],
    ['1C', 'Chrysler', 'Chrysler'],
    ['2C', 'Chrysler Canada', 'Chrysler'],
    ['3C', 'Chrysler Mexico', 'Chrysler'],
    ['1N', 'Nissan', 'Nissan'],
    ['1D', 'Dodge', 'Dodge'],
    ['1B', 'Dodge', 'Dodge'],
    ['1H', 'Honda', 'Honda'],
    ['1L', 'Lincoln', 'Lincoln'],
    ['1Z', 'Ford', 'Ford'], // Mazda/Ford
    ['2T', 'Toyota Canada', 'Toyota'],
    ['3V', 'Volkswagen Mexico', 'Volkswagen'],
    ['4T', 'Toyota', 'Toyota'],
    ['5T', 'Toyota', 'Toyota'],
    ['JT', 'Toyota', 'Toyota'],
    ['JH', 'Honda', 'Honda'],
    ['JN', 'Nissan', 'Nissan'],
    ['JM', 'Mazda', 'Mazda'],
    ['WA', 'Audi', 'Audi'],
    ['WB', 'BMW', 'BMW'],
    ['WD', 'Mercedes-Benz', 'Mercedes-Benz'],
    ['WF', 'Ford Germany', 'Ford'],
    ['WP', 'Porsche', 'Porsche'],
    ['WV', 'Volkswagen', 'Volkswagen'],
    ['ZF', 'Ferrari', 'Ferrari'],
    ['ZA', 'Alfa Romeo', 'Alfa Romeo'],
    ['SA', 'Jaguar', 'Jaguar'],
    ['SJ', 'Jaguar', 'Jaguar'],
    ['SC', 'Lotus', 'Lotus'],
    ['YV', 'Volvo', 'Volvo'],
  ];

  for (const [prefix, manufacturer, make] of manufacturerMap) {
    if (wmi.startsWith(prefix)) {
      result.manufacturer = manufacturer;
      if (make) result.make = make;
      break;
    }
  }

  // Model year (position 10)
  const yearChar = vin.charAt(9);
  result.year = decodeYearCharacter(yearChar);

  // Plant code (position 11)
  result.plant = vin.charAt(10);

  // Serial number (positions 12-17)
  result.serial_number = vin.substring(11);

  return result;
}

/**
 * Decode modern VIN year character (position 10)
 */
function decodeYearCharacter(char: string): number | null {
  const yearMap: Record<string, number> = {
    'A': 1980, 'B': 1981, 'C': 1982, 'D': 1983, 'E': 1984,
    'F': 1985, 'G': 1986, 'H': 1987, 'J': 1988, 'K': 1989,
    'L': 1990, 'M': 1991, 'N': 1992, 'P': 1993, 'R': 1994,
    'S': 1995, 'T': 1996, 'V': 1997, 'W': 1998, 'X': 1999,
    'Y': 2000, '1': 2001, '2': 2002, '3': 2003, '4': 2004,
    '5': 2005, '6': 2006, '7': 2007, '8': 2008, '9': 2009,
    // Pattern repeats after 2009
    // 2010-2039
  };

  if (yearMap[char]) {
    return yearMap[char];
  }

  // Handle 2010+ (repeating cycle)
  if ('A' <= char && char <= 'Y' && char !== 'I' && char !== 'O' && char !== 'Q') {
    const baseYear = yearMap[char];
    if (baseYear) {
      // Could be 30 years later
      const currentYear = new Date().getFullYear();
      const futureYear = baseYear + 30;
      // Choose the most likely year based on current date
      return futureYear <= currentYear + 1 ? futureYear : baseYear;
    }
  }

  return null;
}

