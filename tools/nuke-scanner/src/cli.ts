#!/usr/bin/env node

/**
 * Nuke Scanner CLI
 *
 * Command-line interface for scanning and extracting vehicle data.
 */

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { FileScanner } from './scanner.js';
import { VehicleExtractor } from './extractor.js';

program
  .name('nuke-scan')
  .description('Scan files for vehicle data')
  .version('0.1.0');

program
  .command('scan')
  .description('Scan directories for vehicle-related files')
  .argument('<paths...>', 'Directories or files to scan')
  .option('-d, --depth <number>', 'Maximum scan depth', '10')
  .option('-i, --images', 'Include image files', true)
  .option('-D, --documents', 'Include document files', true)
  .option('-s, --spreadsheets', 'Include spreadsheet files', true)
  .option('-H, --hidden', 'Include hidden files', false)
  .option('-o, --output <file>', 'Output file (JSON)')
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (paths: string[], options) => {
    const scanner = new FileScanner({
      paths,
      maxDepth: parseInt(options.depth),
      includeHidden: options.hidden,
      fileTypes: {
        images: options.images,
        documents: options.documents,
        spreadsheets: options.spreadsheets,
      },
    });

    console.log(`Scanning ${paths.length} path(s)...`);

    const results = await scanner.scan();
    const stats = FileScanner.getStats(results);

    console.log(`\nFound ${stats.total} files:`);
    for (const [category, count] of Object.entries(stats.byCategory)) {
      console.log(`  ${category}: ${count}`);
    }
    console.log(`Total size: ${formatBytes(stats.totalSize)}`);

    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(results, null, 2));
      console.log(`\nResults saved to ${options.output}`);
    }

    if (options.verbose) {
      console.log('\nFiles:');
      for (const result of results) {
        console.log(`  ${result.filename} (${result.category})`);
      }
    }
  });

program
  .command('extract')
  .description('Extract vehicle data from files')
  .argument('<paths...>', 'Files or directories to extract from')
  .option('-o, --output <file>', 'Output file (JSON)')
  .option('--dedupe', 'Deduplicate vehicles', true)
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (paths: string[], options) => {
    // First scan
    const scanner = new FileScanner({ paths });
    console.log('Scanning...');
    const files = await scanner.scan();

    // Then extract
    const extractor = new VehicleExtractor();
    console.log(`Extracting from ${files.length} files...`);

    const results = await extractor.extractBatch(files);

    // Collect all vehicles
    let vehicles = results.flatMap(r => r.vehicles);
    console.log(`Found ${vehicles.length} potential vehicles`);

    // Deduplicate
    if (options.dedupe) {
      vehicles = VehicleExtractor.deduplicate(vehicles);
      console.log(`After deduplication: ${vehicles.length} vehicles`);
    }

    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(vehicles, null, 2));
      console.log(`\nResults saved to ${options.output}`);
    } else {
      console.log('\nVehicles:');
      for (const vehicle of vehicles) {
        const label = [vehicle.year, vehicle.make, vehicle.model]
          .filter(Boolean)
          .join(' ');
        console.log(`  ${label || 'Unknown'} (confidence: ${(vehicle.confidence * 100).toFixed(0)}%)`);
        if (vehicle.vin) console.log(`    VIN: ${vehicle.vin}`);
        if (options.verbose) {
          console.log(`    Source: ${vehicle.sourceFile}`);
        }
      }
    }
  });

program
  .command('csv')
  .description('Parse a CSV file for vehicle data')
  .argument('<file>', 'CSV file to parse')
  .option('-o, --output <file>', 'Output file (JSON)')
  .action(async (file: string, options) => {
    const { CsvParser } = await import('./parsers/csv.js');
    const parser = new CsvParser();

    try {
      console.log(`Parsing ${file}...`);
      const vehicles = await parser.parse(file);

      console.log(`Found ${vehicles.length} vehicles`);

      if (options.output) {
        fs.writeFileSync(options.output, JSON.stringify(vehicles, null, 2));
        console.log(`\nResults saved to ${options.output}`);
      } else {
        for (const vehicle of vehicles) {
          const label = [vehicle.year, vehicle.make, vehicle.model]
            .filter(Boolean)
            .join(' ');
          console.log(`  ${label || 'Unknown'}`);
          if (vehicle.vin) console.log(`    VIN: ${vehicle.vin}`);
          if (vehicle.mileage) console.log(`    Mileage: ${vehicle.mileage.toLocaleString()}`);
          if (vehicle.price) console.log(`    Price: $${vehicle.price.toLocaleString()}`);
        }
      }
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
