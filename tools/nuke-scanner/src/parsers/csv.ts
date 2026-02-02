/**
 * CSV Parser
 *
 * Parses CSV files for vehicle data.
 */

import * as fs from 'fs';
import { parse } from 'csv-parse/sync';

interface CsvVehicle {
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
  confidence: number;
}

// Map of column header variations to standard field names
const COLUMN_MAP: Record<string, string[]> = {
  year: ['year', 'model year', 'yr', 'vehicle year'],
  make: ['make', 'manufacturer', 'brand', 'vehicle make'],
  model: ['model', 'model name', 'vehicle model'],
  vin: ['vin', 'vehicle identification number', 'vin number', 'serial'],
  mileage: ['mileage', 'miles', 'odometer', 'odo', 'km', 'kilometers'],
  price: ['price', 'asking price', 'sale price', 'cost', 'value', 'amount'],
  color: ['color', 'exterior color', 'ext color', 'paint', 'exterior'],
  transmission: ['transmission', 'trans', 'gearbox', 'tranny'],
  engine: ['engine', 'motor', 'engine type', 'displacement'],
  description: ['description', 'notes', 'comments', 'details', 'remarks'],
};

export class CsvParser {
  /**
   * Parse a CSV file and extract vehicle data
   */
  async parse(filePath: string): Promise<CsvVehicle[]> {
    let content: string;

    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(`File not found: ${filePath}`);
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error(`Permission denied: ${filePath}`);
      } else if (error.code === 'EISDIR') {
        throw new Error(`Path is a directory, not a file: ${filePath}`);
      } else {
        throw new Error(`Failed to read file ${filePath}: ${error.message}`);
      }
    }

    if (!content || content.trim().length === 0) {
      throw new Error(`File is empty: ${filePath}`);
    }

    try {
      return this.parseContent(content);
    } catch (error: any) {
      throw new Error(`Failed to parse CSV file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Parse CSV content string
   */
  parseContent(content: string): CsvVehicle[] {
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    if (records.length === 0) {
      return [];
    }

    // Get headers
    const headers = Object.keys(records[0]).map(h => h.toLowerCase().trim());

    // Map headers to standard fields
    const columnMapping = this.mapColumns(headers);

    // Parse records
    const vehicles: CsvVehicle[] = [];

    for (const record of records) {
      const vehicle = this.parseRecord(record, columnMapping);
      if (vehicle.confidence > 0) {
        vehicles.push(vehicle);
      }
    }

    return vehicles;
  }

  /**
   * Map CSV headers to standard field names
   */
  private mapColumns(headers: string[]): Map<string, string> {
    const mapping = new Map<string, string>();

    for (const [field, variations] of Object.entries(COLUMN_MAP)) {
      for (const header of headers) {
        if (variations.some(v => header.includes(v))) {
          mapping.set(header, field);
          break;
        }
      }
    }

    return mapping;
  }

  /**
   * Parse a single CSV record into a vehicle
   */
  private parseRecord(record: Record<string, string>, columnMapping: Map<string, string>): CsvVehicle {
    const vehicle: CsvVehicle = { confidence: 0 };

    for (const [header, value] of Object.entries(record)) {
      const field = columnMapping.get(header.toLowerCase());
      if (!field || !value) continue;

      switch (field) {
        case 'year':
          const year = parseInt(value);
          if (year >= 1900 && year <= new Date().getFullYear() + 1) {
            vehicle.year = year;
            vehicle.confidence += 0.2;
          }
          break;

        case 'make':
          vehicle.make = this.normalizeMake(value);
          vehicle.confidence += 0.2;
          break;

        case 'model':
          vehicle.model = value;
          vehicle.confidence += 0.2;
          break;

        case 'vin':
          if (this.isValidVin(value)) {
            vehicle.vin = value.toUpperCase();
            vehicle.confidence += 0.3;
          }
          break;

        case 'mileage':
          const mileage = parseInt(value.replace(/[^0-9]/g, ''));
          if (!isNaN(mileage) && mileage > 0) {
            vehicle.mileage = mileage;
            vehicle.confidence += 0.1;
          }
          break;

        case 'price':
          const price = parseInt(value.replace(/[^0-9]/g, ''));
          if (!isNaN(price) && price > 0) {
            vehicle.price = price;
            vehicle.confidence += 0.1;
          }
          break;

        case 'color':
          vehicle.color = value;
          vehicle.confidence += 0.05;
          break;

        case 'transmission':
          vehicle.transmission = value;
          vehicle.confidence += 0.05;
          break;

        case 'engine':
          vehicle.engine = value;
          vehicle.confidence += 0.05;
          break;

        case 'description':
          vehicle.description = value;
          break;
      }
    }

    // Cap confidence
    vehicle.confidence = Math.min(vehicle.confidence, 1.0);

    return vehicle;
  }

  /**
   * Validate VIN format
   */
  private isValidVin(vin: string): boolean {
    // VIN must be 17 characters, no I/O/Q
    return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
  }

  /**
   * Normalize vehicle make names
   */
  private normalizeMake(make: string): string {
    const normalized = make.toLowerCase().trim();

    const makeMap: Record<string, string> = {
      'chevy': 'Chevrolet',
      'chevrolet': 'Chevrolet',
      'vw': 'Volkswagen',
      'volkswagen': 'Volkswagen',
      'mercedes': 'Mercedes-Benz',
      'mercedes-benz': 'Mercedes-Benz',
    };

    return makeMap[normalized] || make;
  }
}
