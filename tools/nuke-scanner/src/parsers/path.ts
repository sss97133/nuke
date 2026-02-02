/**
 * Path Parser
 *
 * Extracts vehicle information from file paths and names.
 */

import * as path from 'path';

interface PathExtraction {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  confidence: number;
}

// Common vehicle makes
const MAKES = new Map<string, string>([
  ['chevrolet', 'Chevrolet'],
  ['chevy', 'Chevrolet'],
  ['ford', 'Ford'],
  ['dodge', 'Dodge'],
  ['gmc', 'GMC'],
  ['toyota', 'Toyota'],
  ['honda', 'Honda'],
  ['nissan', 'Nissan'],
  ['mazda', 'Mazda'],
  ['subaru', 'Subaru'],
  ['bmw', 'BMW'],
  ['mercedes', 'Mercedes-Benz'],
  ['mercedes-benz', 'Mercedes-Benz'],
  ['porsche', 'Porsche'],
  ['ferrari', 'Ferrari'],
  ['lamborghini', 'Lamborghini'],
  ['audi', 'Audi'],
  ['volkswagen', 'Volkswagen'],
  ['vw', 'Volkswagen'],
  ['jeep', 'Jeep'],
  ['ram', 'Ram'],
  ['buick', 'Buick'],
  ['cadillac', 'Cadillac'],
  ['chrysler', 'Chrysler'],
  ['lincoln', 'Lincoln'],
  ['lexus', 'Lexus'],
  ['acura', 'Acura'],
  ['infiniti', 'Infiniti'],
  ['hyundai', 'Hyundai'],
  ['kia', 'Kia'],
  ['volvo', 'Volvo'],
  ['jaguar', 'Jaguar'],
  ['land rover', 'Land Rover'],
  ['landrover', 'Land Rover'],
  ['tesla', 'Tesla'],
  ['pontiac', 'Pontiac'],
  ['oldsmobile', 'Oldsmobile'],
  ['plymouth', 'Plymouth'],
  ['amc', 'AMC'],
  ['international', 'International'],
  ['ih', 'International'],
]);

// Common vehicle models
const MODELS = new Set([
  'mustang', 'camaro', 'corvette', 'challenger', 'charger',
  'silverado', 'f150', 'f-150', 'f250', 'f-250', 'f350', 'f-350',
  'c10', 'c20', 'c30', 'k10', 'k20', 'k5', 'c1500', 'k1500',
  'blazer', 'suburban', 'tahoe', 'yukon', 'bronco', 'scout',
  'wrangler', 'cherokee', 'grand cherokee', 'rav4', 'tacoma', '4runner',
  'civic', 'accord', 'crx', 'integra', 'nsx',
  '911', '944', '928', 'cayenne', 'cayman', 'boxster',
  'm3', 'm5', 'e30', 'e36', 'e46', 'e90',
  'gtr', 'gt-r', 'skyline', '240z', '260z', '280z', '300zx',
  'supra', 'ae86', 'mr2', 'celica',
  'rx7', 'rx-7', 'miata', 'mx5', 'mx-5',
  'impreza', 'wrx', 'sti', 'outback', 'forester',
]);

export class PathParser {
  /**
   * Parse vehicle info from file path
   */
  parse(filePath: string): PathExtraction {
    const result: PathExtraction = { confidence: 0 };

    // Normalize path
    const normalizedPath = filePath.toLowerCase().replace(/[_-]/g, ' ');
    const filename = path.basename(normalizedPath, path.extname(normalizedPath));
    const dirPath = path.dirname(normalizedPath);

    // Combine for searching
    const searchText = `${dirPath} ${filename}`;

    // Extract year (1900-2030)
    const yearMatch = searchText.match(/\b(19[0-9]{2}|20[0-3][0-9])\b/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1]);
      // Validate year is reasonable for a vehicle
      if (year >= 1900 && year <= new Date().getFullYear() + 1) {
        result.year = year;
        result.confidence += 0.3;
      }
    }

    // Extract make
    for (const [pattern, make] of MAKES) {
      // Use word boundary matching
      const regex = new RegExp(`\\b${pattern}\\b`, 'i');
      if (regex.test(searchText)) {
        result.make = make;
        result.confidence += 0.3;
        break;
      }
    }

    // Extract model
    for (const model of MODELS) {
      const regex = new RegExp(`\\b${model}\\b`, 'i');
      if (regex.test(searchText)) {
        result.model = model.toUpperCase();
        result.confidence += 0.3;
        break;
      }
    }

    // Extract VIN (17 alphanumeric characters, no I/O/Q)
    const vinMatch = searchText.match(/\b[a-hj-npr-z0-9]{17}\b/i);
    if (vinMatch) {
      result.vin = vinMatch[0].toUpperCase();
      result.confidence += 0.5;
    }

    // Cap confidence at 1.0
    result.confidence = Math.min(result.confidence, 1.0);

    return result;
  }

  /**
   * Extract all vehicle hints from a path (for folders with multiple vehicles)
   */
  parseAll(filePath: string): PathExtraction[] {
    const results: PathExtraction[] = [];
    const parts = filePath.split(path.sep);

    for (const part of parts) {
      const extraction = this.parse(part);
      if (extraction.confidence > 0.2) {
        results.push(extraction);
      }
    }

    return results;
  }
}
