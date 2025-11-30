/**
 * Vehicle Data Extraction Service for Automation
 * 
 * Intelligently extracts and normalizes vehicle data from scraped listings.
 * Separates model, series, and trim for proper database categorization.
 * Designed for automated scraping of millions of vehicles.
 */

import { 
  vehicleModelHierarchy, 
  normalizeModelName, 
  getSeriesOptions,
  type ModelSeriesTrim 
} from '../data/vehicleModelHierarchy';

export interface ExtractedVehicleFields {
  make: string;
  model: string;
  series: string | null;
  trim: string | null;
  confidence: 'high' | 'medium' | 'low';
  extractionMethod: 'hierarchy_match' | 'pattern_match' | 'fallback';
}

export interface SquarebodyDetection {
  isSquarebody: boolean;
  yearRange: '1973-1987' | '1988-1991' | 'other' | null;
  confidence: number;
}

export class VehicleDataExtractionService {
  /**
   * Extract and normalize model/series/trim from raw scraped data
   * Handles cases like:
   * - "K5 Blazer" → model: "Blazer", series: "K5"
   * - "C10 Pickup" → model: "C/K", series: "C10"
   * - "1977 K10 Silverado" → model: "C/K", series: "K10", trim: "Silverado"
   */
  static extractVehicleFields(
    rawMake: string | null | undefined,
    rawModel: string | null | undefined,
    rawTitle?: string | null,
    rawDescription?: string | null,
    year?: number | null
  ): ExtractedVehicleFields {
    const make = this.normalizeMake(rawMake);
    if (!make) {
      return {
        make: rawMake || 'Unknown',
        model: rawModel || 'Unknown',
        series: null,
        trim: null,
        confidence: 'low',
        extractionMethod: 'fallback'
      };
    }

    // Combine all text sources for pattern matching
    const searchText = [
      rawModel,
      rawTitle,
      rawDescription
    ].filter(Boolean).join(' ').toUpperCase();

    // Try hierarchy-based extraction first
    const hierarchyMatch = this.extractFromHierarchy(make, rawModel, searchText, year);
    if (hierarchyMatch.confidence === 'high') {
      return hierarchyMatch;
    }

    // Try pattern-based extraction
    const patternMatch = this.extractFromPatterns(make, rawModel, searchText, year);
    if (patternMatch.confidence === 'high' || patternMatch.confidence === 'medium') {
      return patternMatch;
    }

    // Fallback: normalize model name but don't extract series/trim
    return {
      make,
      model: normalizeModelName(rawModel || 'Unknown'),
      series: null,
      trim: null,
      confidence: 'low',
      extractionMethod: 'fallback'
    };
  }

  /**
   * Extract using hierarchy data (most accurate)
   */
  private static extractFromHierarchy(
    make: string,
    rawModel: string | null | undefined,
    searchText: string,
    year?: number | null
  ): ExtractedVehicleFields {
    const normalizedModel = normalizeModelName(rawModel || '');
    
    // Find matching hierarchy entry
    const hierarchy = vehicleModelHierarchy.find(
      h => h.make.toLowerCase() === make.toLowerCase() &&
           h.model.toLowerCase() === normalizedModel.toLowerCase()
    );

    if (!hierarchy) {
      return {
        make,
        model: normalizedModel,
        series: null,
        trim: null,
        confidence: 'low',
        extractionMethod: 'fallback'
      };
    }

    // Try to extract series from search text
    let extractedSeries: string | null = null;
    let extractedTrim: string | null = null;

    // Look for series codes in search text
    for (const seriesOption of hierarchy.series) {
      const seriesPattern = new RegExp(`\\b${seriesOption.code}\\b`, 'i');
      if (seriesPattern.test(searchText)) {
        extractedSeries = seriesOption.code;
        break;
      }
    }

    // Look for trim names in search text
    if (extractedSeries) {
      const trims = hierarchy.trims[extractedSeries] || [];
      for (const trimOption of trims) {
        const trimPattern = new RegExp(`\\b${trimOption.name}\\b`, 'i');
        if (trimPattern.test(searchText)) {
          extractedTrim = trimOption.name;
          break;
        }
      }
    }

    // If we found series, confidence is high
    if (extractedSeries) {
      return {
        make,
        model: hierarchy.model,
        series: extractedSeries,
        trim: extractedTrim,
        confidence: 'high',
        extractionMethod: 'hierarchy_match'
      };
    }

    // If model matches but no series found, medium confidence
    return {
      make,
      model: hierarchy.model,
      series: null,
      trim: null,
      confidence: 'medium',
      extractionMethod: 'hierarchy_match'
    };
  }

  /**
   * Extract using pattern matching (for cases not in hierarchy)
   */
  private static extractFromPatterns(
    make: string,
    rawModel: string | null | undefined,
    searchText: string,
    year?: number | null
  ): ExtractedVehicleFields {
    // Squarebody series patterns
    const seriesPatterns = [
      { pattern: /\b(K5|C5)\b/i, series: 'K5', model: 'Blazer' },
      { pattern: /\b(C10|K10)\b/i, series: null, model: 'C/K' }, // Will extract actual series
      { pattern: /\b(C20|K20)\b/i, series: null, model: 'C/K' },
      { pattern: /\b(C30|K30)\b/i, series: null, model: 'C/K' },
      { pattern: /\b(C1500|K1500)\b/i, series: null, model: 'C/K' },
      { pattern: /\b(C2500|K2500)\b/i, series: null, model: 'C/K' },
    ];

    for (const { pattern, series, model: suggestedModel } of seriesPatterns) {
      const match = searchText.match(pattern);
      if (match) {
        const matchedSeries = series || match[1].toUpperCase();
        
        // Determine actual series code
        let actualSeries = matchedSeries;
        if (matchedSeries.includes('10')) {
          actualSeries = matchedSeries.startsWith('C') ? 'C10' : 'K10';
        } else if (matchedSeries.includes('20')) {
          actualSeries = matchedSeries.startsWith('C') ? 'C20' : 'K20';
        } else if (matchedSeries.includes('30')) {
          actualSeries = matchedSeries.startsWith('C') ? 'C30' : 'K30';
        } else if (matchedSeries.includes('1500')) {
          actualSeries = matchedSeries.startsWith('C') ? 'C1500' : 'K1500';
        } else if (matchedSeries.includes('2500')) {
          actualSeries = matchedSeries.startsWith('C') ? 'C2500' : 'K2500';
        }

        // Extract trim if possible
        const trimPatterns = [
          /\b(SILVERADO|CHEYENNE|SCOTTSDALE|CUSTOM DELUXE|BIG 10|BASE)\b/i
        ];
        let extractedTrim: string | null = null;
        for (const trimPattern of trimPatterns) {
          const trimMatch = searchText.match(trimPattern);
          if (trimMatch) {
            extractedTrim = trimMatch[1].charAt(0) + trimMatch[1].slice(1).toLowerCase();
            break;
          }
        }

        return {
          make,
          model: suggestedModel || normalizeModelName(rawModel || ''),
          series: actualSeries,
          trim: extractedTrim,
          confidence: 'high',
          extractionMethod: 'pattern_match'
        };
      }
    }

    return {
      make,
      model: normalizeModelName(rawModel || ''),
      series: null,
      trim: null,
      confidence: 'low',
      extractionMethod: 'fallback'
    };
  }

  /**
   * Detect if a vehicle is a squarebody (1973-1991 GM trucks/SUVs)
   */
  static detectSquarebody(
    make: string | null | undefined,
    model: string | null | undefined,
    year: number | null | undefined,
    title?: string | null,
    description?: string | null
  ): SquarebodyDetection {
    const makeLower = (make || '').toLowerCase();
    const modelLower = (model || '').toLowerCase();
    const searchText = [
      title,
      description,
      model
    ].filter(Boolean).join(' ').toLowerCase();

    // Check if it's GM
    const isGM = makeLower.includes('chevrolet') || 
                 makeLower.includes('chevy') || 
                 makeLower.includes('gmc');

    if (!isGM) {
      return {
        isSquarebody: false,
        yearRange: null,
        confidence: 0
      };
    }

    // Check year range
    const isSquarebodyYear = year && year >= 1973 && year <= 1991;
    const isClassicSquarebody = year && year >= 1973 && year <= 1987;
    const isGMT400 = year && year >= 1988 && year <= 1991;

    // Check for squarebody indicators
    const hasSquarebodyTerms = /squarebody|square body|square-body/i.test(searchText);
    const hasSquarebodyModel = /^(C|K)\d{1,2}$|^(C|K)\d{4}$|blazer|jimmy|suburban|sierra/i.test(modelLower);
    const hasSquarebodySeries = /\b(K5|C5|K10|C10|K20|C20|K30|C30|K1500|C1500|K2500|C2500)\b/i.test(searchText);

    let confidence = 0;
    let yearRange: SquarebodyDetection['yearRange'] = null;

    if (isSquarebodyYear) {
      if (hasSquarebodyTerms || hasSquarebodyModel || hasSquarebodySeries) {
        confidence = 0.95;
        yearRange = isClassicSquarebody ? '1973-1987' : '1988-1991';
      } else if (isGM && (hasSquarebodyModel || hasSquarebodySeries)) {
        confidence = 0.85;
        yearRange = isClassicSquarebody ? '1973-1987' : '1988-1991';
      }
    } else if (hasSquarebodyTerms || hasSquarebodyModel || hasSquarebodySeries) {
      confidence = 0.75;
      yearRange = 'other';
    }

    return {
      isSquarebody: confidence > 0.7,
      yearRange,
      confidence
    };
  }

  /**
   * Normalize make name
   */
  private static normalizeMake(make: string | null | undefined): string | null {
    if (!make) return null;
    
    const makeLower = make.toLowerCase().trim();
    
    // Common variations
    if (makeLower.includes('chevrolet') || makeLower.includes('chevy')) {
      return 'Chevrolet';
    }
    if (makeLower.includes('gmc')) {
      return 'GMC';
    }
    if (makeLower.includes('ford')) {
      return 'Ford';
    }
    if (makeLower.includes('dodge') || makeLower.includes('ram')) {
      return 'Dodge';
    }
    
    // Capitalize first letter of each word
    return make.split(' ').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  }

  /**
   * Extract series from model name (e.g., "K5 Blazer" → "K5")
   */
  static extractSeriesFromModel(model: string | null | undefined): string | null {
    if (!model) return null;
    
    const modelUpper = model.toUpperCase();
    const seriesPatterns = [
      /\b(K5|C5)\b/,
      /\b(K10|C10)\b/,
      /\b(K20|C20)\b/,
      /\b(K30|C30)\b/,
      /\b(K1500|C1500)\b/,
      /\b(K2500|C2500)\b/,
    ];

    for (const pattern of seriesPatterns) {
      const match = modelUpper.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }
}

