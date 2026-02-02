/**
 * Vehicle Data Extractor
 *
 * Extracts vehicle information from various file types.
 */

import * as fs from 'fs';
import { ScanResult } from './scanner.js';
import { CsvParser } from './parsers/csv.js';
import { PathParser } from './parsers/path.js';

export interface ExtractedVehicle {
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  mileage?: number;
  price?: number;
  color?: string;
  transmission?: string;
  engine?: string;
  description?: string;
  sourceFile: string;
  confidence: number;
}

export interface ExtractionResult {
  file: ScanResult;
  vehicles: ExtractedVehicle[];
  errors?: string[];
}

export class VehicleExtractor {
  private pathParser: PathParser;
  private csvParser: CsvParser;

  constructor() {
    this.pathParser = new PathParser();
    this.csvParser = new CsvParser();
  }

  /**
   * Extract vehicle data from a file
   */
  async extract(file: ScanResult): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      file,
      vehicles: [],
    };

    try {
      // Always try path-based extraction
      const pathVehicle = this.pathParser.parse(file.path);
      if (pathVehicle && pathVehicle.confidence > 0.3) {
        result.vehicles.push({
          ...pathVehicle,
          sourceFile: file.path,
        });
      }

      // File-type specific extraction
      switch (file.category) {
        case 'spreadsheet':
          if (file.extension === 'csv') {
            const csvVehicles = await this.csvParser.parse(file.path);
            result.vehicles.push(...csvVehicles.map(v => ({
              ...v,
              sourceFile: file.path,
            })));
          }
          break;

        case 'document':
          // PDF extraction would require pdf-parse
          // For now, just use path-based extraction
          break;

        case 'image':
          // Image analysis would require AI/ML
          // For now, just use path-based extraction
          break;
      }
    } catch (error: any) {
      result.errors = [error.message];
    }

    return result;
  }

  /**
   * Extract from multiple files
   */
  async extractBatch(files: ScanResult[]): Promise<ExtractionResult[]> {
    const results: ExtractionResult[] = [];

    for (const file of files) {
      const result = await this.extract(file);
      results.push(result);
    }

    return results;
  }

  /**
   * Deduplicate extracted vehicles
   */
  static deduplicate(vehicles: ExtractedVehicle[]): ExtractedVehicle[] {
    const seen = new Map<string, ExtractedVehicle>();

    for (const vehicle of vehicles) {
      // Create a key based on available data
      const key = vehicle.vin ||
        `${vehicle.year}-${vehicle.make}-${vehicle.model}`.toLowerCase();

      const existing = seen.get(key);
      if (!existing || vehicle.confidence > existing.confidence) {
        seen.set(key, vehicle);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Merge multiple extraction results for the same vehicle
   */
  static merge(vehicles: ExtractedVehicle[]): ExtractedVehicle {
    if (vehicles.length === 0) {
      throw new Error('Cannot merge empty array');
    }

    if (vehicles.length === 1) {
      return vehicles[0];
    }

    // Sort by confidence (highest first)
    const sorted = [...vehicles].sort((a, b) => b.confidence - a.confidence);

    // Merge fields, preferring higher confidence sources
    const merged: ExtractedVehicle = {
      sourceFile: sorted[0].sourceFile,
      confidence: sorted[0].confidence,
    };

    const fields: (keyof ExtractedVehicle)[] = [
      'year', 'make', 'model', 'vin', 'mileage',
      'price', 'color', 'transmission', 'engine', 'description',
    ];

    for (const field of fields) {
      for (const vehicle of sorted) {
        if (vehicle[field] !== undefined) {
          (merged as any)[field] = vehicle[field];
          break;
        }
      }
    }

    return merged;
  }
}
