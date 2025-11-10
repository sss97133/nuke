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
 * Decode pre-1981 GM truck VIN
 * Format: CE1418647123 (example 1967-1972)
 * C = Division (Chevrolet Truck)
 * E = Engine
 * 14 = Series (C10 = 1/2 ton)
 * 1 = Body type
 * 8 = Year (8 = 1968, 9 = 1969, 0 = 1970, etc.)
 * 647123 = Sequential production number
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

  // GM Truck VIN - 1967-1972 format: CE1418647123 (12-13 chars)
  if ((vin.startsWith('C') || vin.startsWith('T')) && vin.length >= 10) {
    result.manufacturer = 'General Motors';
    
    // Division code (first char)
    const divisionCode = vin.charAt(0);
    if (divisionCode === 'C') {
      result.make = 'Chevrolet';
    } else if (divisionCode === 'T') {
      result.make = 'GMC';
    }

    // Engine code (second char)
    const engineCode = vin.charAt(1);
    if (engineCode === 'E') {
      result.engine_size = 'V8';
    } else if (engineCode === 'S') {
      result.engine_size = 'I6';
    }

    // Series code (positions 2-3): 14 = C10, 24 = C20, 34 = C30
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

    // Body type (position 4): 1 = Pickup, 3 = Cab&Chassis, etc.
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

    // Year code (position 5) - THIS IS THE CRITICAL FIX!
    // For 1967-1972: 7=1967, 8=1968, 9=1969, 0=1970, 1=1971, 2=1972
    const yearChar = vin.charAt(5);
    if (/\d/.test(yearChar)) {
      const yearDigit = parseInt(yearChar);
      // Decode based on 1960s-1970s pattern
      if (yearDigit === 7) result.year = 1967;
      else if (yearDigit === 8) result.year = 1968;
      else if (yearDigit === 9) result.year = 1969;
      else if (yearDigit === 0) result.year = 1970;
      else if (yearDigit === 1) result.year = 1971;
      else if (yearDigit === 2) result.year = 1972;
      else if (yearDigit === 3) result.year = 1973;
      else if (yearDigit === 4) result.year = 1974;
      else if (yearDigit === 5) result.year = 1975;
      else if (yearDigit === 6) result.year = 1976;
    }

    // Sequential number (remaining digits after year)
    result.serial_number = vin.substring(6);
  }

  // Ford pre-1981 (different format)
  else if (vin.startsWith('F')) {
    result.manufacturer = 'Ford Motor Company';
    result.make = 'Ford';
    // TODO: Implement Ford pre-1981 decoding
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
  
  // Manufacturer lookup
  const manufacturerMap: Record<string, string> = {
    '1G': 'General Motors',
    '1GC': 'Chevrolet Truck',
    '1GN': 'Chevrolet',
    '2G': 'General Motors Canada',
    '3G': 'General Motors Mexico',
    '1F': 'Ford',
    '1FT': 'Ford Truck',
    '2F': 'Ford Canada',
    '1J': 'Jeep',
    '1C': 'Chrysler',
    '2C': 'Chrysler Canada',
    '1N': 'Nissan',
    '1D': 'Dodge'
  };

  for (const [prefix, manufacturer] of Object.entries(manufacturerMap)) {
    if (wmi.startsWith(prefix)) {
      result.manufacturer = manufacturer;
      if (manufacturer.includes('Chevrolet')) result.make = 'Chevrolet';
      else if (manufacturer.includes('Ford')) result.make = 'Ford';
      else if (manufacturer.includes('Jeep')) result.make = 'Jeep';
      else if (manufacturer.includes('Chrysler') || manufacturer.includes('Dodge')) {
        result.make = manufacturer.includes('Dodge') ? 'Dodge' : 'Chrysler';
      }
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

