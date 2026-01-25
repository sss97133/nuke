/**
 * GM Truck Nomenclature Normalization
 * 
 * GM trucks have a complex naming system:
 * - Series: C10, C20, C30 (2WD) or K10, K20, K30 (4WD)
 * - Model: Pickup, Suburban, Blazer, Jimmy
 * - Trim: Custom Deluxe, Scottsdale, Silverado, Cheyenne
 * 
 * Common issues in listings:
 * - "1/2 ton" instead of "C10" or "K10"
 * - "3/4 ton" instead of "C20" or "K20"
 * - "1 ton" instead of "C30" or "K30"
 * - Trim in wrong field
 * - Series omitted entirely
 */

// GM Truck trim levels by era
const GM_TRIMS = {
  // 1967-1972 (C/K Series First Gen)
  '1967-1972': ['Custom', 'Custom Sport Truck (CST)', 'Cheyenne', 'Cheyenne Super'],
  // 1973-1987 (C/K Series Square Body)
  '1973-1987': ['Custom Deluxe', 'Scottsdale', 'Silverado', 'Cheyenne'],
  // 1988-1998 (C/K Series GMT400)
  '1988-1998': ['Cheyenne', 'Scottsdale', 'Silverado', 'Silverado Sport', '454 SS'],
  // 1999+ (Silverado)
  '1999+': ['WT', 'LS', 'LT', 'LTZ', 'High Country', 'RST', 'Trail Boss', 'ZR2']
};

// Series to weight class mapping
const SERIES_WEIGHT_MAP = {
  'C10': '1/2 ton',
  'K10': '1/2 ton',
  'C1500': '1/2 ton',
  'K1500': '1/2 ton',
  'R1500': '1/2 ton',
  'V1500': '1/2 ton',
  'C20': '3/4 ton',
  'K20': '3/4 ton',
  'C2500': '3/4 ton',
  'K2500': '3/4 ton',
  'R2500': '3/4 ton',
  'V2500': '3/4 ton',
  'C30': '1 ton',
  'K30': '1 ton',
  'C3500': '1 ton',
  'K3500': '1 ton',
  'R3500': '1 ton',
  'V3500': '1 ton'
};

// Weight class to series mapping (needs drivetrain context)
const WEIGHT_TO_SERIES = {
  '1/2 ton': { '2WD': 'C10', '4WD': 'K10' },
  'half ton': { '2WD': 'C10', '4WD': 'K10' },
  '3/4 ton': { '2WD': 'C20', '4WD': 'K20' },
  '1 ton': { '2WD': 'C30', '4WD': 'K30' },
  'one ton': { '2WD': 'C30', '4WD': 'K30' }
};

// Known trim indicators (case-insensitive)
const TRIM_INDICATORS = [
  'custom deluxe', 'scottsdale', 'silverado', 'cheyenne', 'cheyenne super',
  'big 10', 'big ten', 'custom sport truck', 'cst', 'stepside', 'fleetside',
  'work truck', 'wt', 'ls', 'lt', 'ltz', 'high country', 'rst', 'trail boss', 'zr2',
  '454 ss', 'ss'
];

// Model types
const MODEL_TYPES = {
  'pickup': ['pickup', 'truck', 'shortbed', 'longbed', 'stepside', 'fleetside', 'regular cab', 'extended cab', 'crew cab'],
  'suburban': ['suburban'],
  'blazer': ['blazer', 'k5 blazer', 'k5'],
  'jimmy': ['jimmy'],
  's-10': ['s-10', 's10'],
  'colorado': ['colorado'],
  'avalanche': ['avalanche']
};

/**
 * Normalize GM vehicle data
 * @param {Object} data - Raw vehicle data
 * @returns {Object} - Normalized data with series, model, trim
 */
export function normalizeGMTruck(data) {
  const result = {
    series: null,
    model: null,
    trim: null,
    drivetrain: null,
    body_style: null,
    corrections: [],
    confidence: 0
  };

  // Combine all text sources for analysis
  const allText = [
    data.title || '',
    data.model || '',
    data.trim || '',
    data.description || ''
  ].join(' ').toLowerCase();
  const rvEra = data.year && data.year >= 1988 && data.year <= 1991;

  // 1. Detect drivetrain (4WD vs 2WD)
  if (allText.match(/\b(4wd|4x4|four wheel drive|4 wheel drive|k10|k20|k30|k1500|k2500|k3500|v1500|v2500|v3500)\b/i)) {
    result.drivetrain = '4WD';
  } else if (allText.match(/\b(2wd|2x4|two wheel drive|rwd|c10|c20|c30|c1500|c2500|c3500|r1500|r2500|r3500)\b/i)) {
    result.drivetrain = '2WD';
  }

  // 2. Extract R/V series for 1988-1991 squarebody
  const rvSeriesMatch = allText.match(/\b(r|v)\s*-?\s*(1500|2500|3500)\b/i);
  if (rvSeriesMatch) {
    const prefix = rvEra ? rvSeriesMatch[1].toUpperCase() : (rvSeriesMatch[1].toLowerCase() === 'r' ? 'C' : 'K');
    result.series = `${prefix}${rvSeriesMatch[2]}`;
    result.confidence += 30;
  }

  // 2. Extract series from text
  const seriesMatch = allText.match(/\b(c|k)(10|20|30|1500|2500|3500)\b/i);
  if (seriesMatch && !result.series) {
    result.series = seriesMatch[0].toUpperCase();
    result.confidence += 30;
  }

  // 3. If no series found, try to derive from weight class
  if (!result.series) {
    for (const [weightClass, seriesMap] of Object.entries(WEIGHT_TO_SERIES)) {
      if (allText.includes(weightClass)) {
        const drivetrain = result.drivetrain || '2WD';
        if (rvEra && (allText.includes('r/v') || allText.includes('rv'))) {
          result.series = drivetrain === '4WD' ? seriesMap['4WD'].replace(/^K/, 'V') : seriesMap['2WD'].replace(/^C/, 'R');
        } else {
          result.series = seriesMap[drivetrain];
        }
        result.corrections.push(`Derived series ${result.series} from "${weightClass}" + ${drivetrain}`);
        result.confidence += 20;
        break;
      }
    }
  }

  // 4. Extract trim level
  for (const trim of TRIM_INDICATORS) {
    if (allText.includes(trim)) {
      result.trim = trim.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      result.confidence += 20;
      break;
    }
  }

  // 5. Determine model type (Pickup, Suburban, etc.)
  for (const [modelType, indicators] of Object.entries(MODEL_TYPES)) {
    for (const indicator of indicators) {
      if (allText.includes(indicator)) {
        result.model = modelType.charAt(0).toUpperCase() + modelType.slice(1);
        result.body_style = modelType === 'pickup' ? 'Truck' : 
                           modelType === 'suburban' ? 'SUV' :
                           modelType === 'blazer' || modelType === 'jimmy' ? 'SUV' : 'Truck';
        result.confidence += 15;
        break;
      }
    }
    if (result.model) break;
  }

  // 6. Default model to Pickup if series indicates truck
  if (!result.model && result.series) {
    result.model = 'Pickup';
    result.body_style = 'Truck';
    result.corrections.push('Defaulted model to Pickup based on series');
  }

  // 7. Detect engine from text (for diesel badge validation)
  if (allText.match(/\bdiesel\b/i)) {
    result.engine_type = 'Diesel';
    result.confidence += 10;
  } else if (allText.match(/\b(350|305|327|396|402|454|502|big block|small block)\b/i)) {
    const engineMatch = allText.match(/\b(350|305|327|396|402|454|502)\b/i);
    if (engineMatch) {
      result.engine_displacement = engineMatch[1];
      result.engine_type = parseInt(engineMatch[1]) >= 396 ? 'Big Block V8' : 'Small Block V8';
    }
    result.confidence += 10;
  }

  // 8. Check for year conflicts in description
  const yearInTitle = data.year;
  const descYearMatch = (data.description || '').match(/\b(19[6-9]\d|20[0-2]\d)\b/);
  if (descYearMatch && yearInTitle) {
    const descYear = parseInt(descYearMatch[0]);
    if (descYear !== yearInTitle && Math.abs(descYear - yearInTitle) <= 5) {
      result.year_conflict = {
        title_year: yearInTitle,
        description_year: descYear,
        message: `Title says ${yearInTitle} but description mentions ${descYear}`
      };
      result.corrections.push(`Potential year conflict: title=${yearInTitle}, description=${descYear}`);
    }
  }

  return result;
}

/**
 * Validate VIN against year/make/model
 * @param {string} vin - Vehicle Identification Number
 * @param {Object} claimed - Claimed year/make/model
 * @returns {Object} - Validation result
 */
export function validateVINAgainstClaims(vin, claimed) {
  const result = {
    valid: true,
    issues: [],
    decoded: {}
  };

  if (!vin || vin.length < 8) {
    result.valid = false;
    result.issues.push('VIN too short or missing');
    return result;
  }

  // Pre-1981 VINs are 8-13 characters
  // 1981+ VINs are 17 characters with check digit
  const is17CharVIN = vin.length === 17;

  if (is17CharVIN) {
    // Decode 17-character VIN
    const yearCode = vin.charAt(9);
    const yearMap = {
      'A': 1980, 'B': 1981, 'C': 1982, 'D': 1983, 'E': 1984, 'F': 1985,
      'G': 1986, 'H': 1987, 'J': 1988, 'K': 1989, 'L': 1990, 'M': 1991,
      'N': 1992, 'P': 1993, 'R': 1994, 'S': 1995, 'T': 1996, 'V': 1997,
      'W': 1998, 'X': 1999, 'Y': 2000, '1': 2001, '2': 2002, '3': 2003,
      '4': 2004, '5': 2005, '6': 2006, '7': 2007, '8': 2008, '9': 2009
    };
    
    const decodedYear = yearMap[yearCode];
    if (decodedYear) {
      result.decoded.year = decodedYear;
      if (claimed.year && claimed.year !== decodedYear) {
        result.valid = false;
        result.issues.push(`VIN indicates ${decodedYear} but listing claims ${claimed.year}`);
      }
    }

    // GM World Manufacturer Identifier (WMI)
    const wmi = vin.substring(0, 3);
    const gmWMIs = ['1GC', '1GT', '2GC', '3GC', '1G1', '1G2', '1GN'];
    if (claimed.make?.toLowerCase().includes('chevrolet') || claimed.make?.toLowerCase().includes('gmc')) {
      if (!gmWMIs.some(w => wmi.startsWith(w.substring(0, 2)))) {
        result.valid = false;
        result.issues.push(`VIN WMI ${wmi} doesn't match GM pattern for ${claimed.make}`);
      }
    }
  } else {
    // Pre-1981 VIN (shorter format)
    // GM trucks used formats like: CE140J142861 (C=Chevy, E=engine, 14=series, 0=year, J=plant)
    // or CCY333S128408 (older format)
    
    // Try to extract year from position
    // This is highly variable for pre-1981 VINs
    result.decoded.format = 'pre-1981';
    result.issues.push('Pre-1981 VIN format - manual verification recommended');
  }

  return result;
}

/**
 * Full normalization and validation pipeline
 */
export function normalizeAndValidate(data) {
  const normalized = normalizeGMTruck(data);
  
  if (data.vin) {
    const vinValidation = validateVINAgainstClaims(data.vin, {
      year: data.year,
      make: data.make,
      model: data.model
    });
    
    normalized.vin_validation = vinValidation;
    
    if (!vinValidation.valid) {
      normalized.corrections.push(...vinValidation.issues);
    }
  }
  
  return normalized;
}

export default {
  normalizeGMTruck,
  validateVINAgainstClaims,
  normalizeAndValidate,
  GM_TRIMS,
  SERIES_WEIGHT_MAP,
  TRIM_INDICATORS
};

