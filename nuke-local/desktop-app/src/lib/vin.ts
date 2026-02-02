/**
 * VIN validation utilities
 */

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

export interface VINValidation {
  valid: boolean;
  normalized: string;
  errors: string[];
  year?: number;
  wmi?: string; // World Manufacturer Identifier (first 3 chars)
}

/**
 * Validate a VIN with check digit verification
 */
export function validateVIN(vin: string): VINValidation {
  const errors: string[] = [];
  const normalized = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

  // Check length
  if (normalized.length !== 17) {
    if (normalized.length < 11) {
      errors.push(`Too short (${normalized.length} chars)`);
    } else if (normalized.length > 17) {
      errors.push(`Too long (${normalized.length} chars)`);
    } else {
      // Pre-1981 VINs were 11-17 chars, no standardization
      return {
        valid: true,
        normalized,
        errors: [],
        wmi: normalized.substring(0, 3),
      };
    }
  }

  // Check for invalid characters
  if (/[IOQ]/i.test(vin)) {
    errors.push("Contains invalid characters (I, O, or Q)");
  }

  // For 17-char VINs, verify check digit
  if (normalized.length === 17 && errors.length === 0) {
    let sum = 0;
    for (let i = 0; i < 17; i++) {
      const char = normalized[i];
      const value = char >= "0" && char <= "9"
        ? parseInt(char, 10)
        : VIN_TRANSLITERATION[char] || 0;
      sum += value * VIN_WEIGHTS[i];
    }

    const checkDigit = sum % 11;
    const expectedCheck = checkDigit === 10 ? "X" : checkDigit.toString();

    if (normalized[8] !== expectedCheck) {
      errors.push(`Invalid check digit (expected ${expectedCheck})`);
    }
  }

  // Decode year from position 10 (for 17-char VINs)
  let year: number | undefined;
  if (normalized.length === 17) {
    year = decodeModelYear(normalized[9]);
  }

  return {
    valid: errors.length === 0,
    normalized,
    errors,
    year,
    wmi: normalized.substring(0, 3),
  };
}

/**
 * Decode model year from VIN position 10
 */
function decodeModelYear(char: string): number | undefined {
  const yearCodes: Record<string, number[]> = {
    A: [1980, 2010],
    B: [1981, 2011],
    C: [1982, 2012],
    D: [1983, 2013],
    E: [1984, 2014],
    F: [1985, 2015],
    G: [1986, 2016],
    H: [1987, 2017],
    J: [1988, 2018],
    K: [1989, 2019],
    L: [1990, 2020],
    M: [1991, 2021],
    N: [1992, 2022],
    P: [1993, 2023],
    R: [1994, 2024],
    S: [1995, 2025],
    T: [1996, 2026],
    V: [1997, 2027],
    W: [1998, 2028],
    X: [1999, 2029],
    Y: [2000, 2030],
    "1": [2001, 2031],
    "2": [2002, 2032],
    "3": [2003, 2033],
    "4": [2004, 2034],
    "5": [2005, 2035],
    "6": [2006, 2036],
    "7": [2007, 2037],
    "8": [2008, 2038],
    "9": [2009, 2039],
  };

  const years = yearCodes[char.toUpperCase()];
  if (!years) return undefined;

  // Return the more recent year if it's plausible
  const currentYear = new Date().getFullYear();
  if (years[1] <= currentYear + 1) {
    return years[1];
  }
  return years[0];
}

/**
 * Format VIN for display (groups of chars)
 */
export function formatVIN(vin: string): string {
  const normalized = vin.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (normalized.length !== 17) return normalized;

  // WMI - VDS - VIS
  return `${normalized.slice(0, 3)} ${normalized.slice(3, 9)} ${normalized.slice(9)}`;
}
