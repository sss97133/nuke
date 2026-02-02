#!/usr/bin/env node

import { FileScanner, VehicleExtractor, CsvParser } from '../dist/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testLibrary() {
  console.log('Testing Nuke Scanner Library\n');

  // Test 1: FileScanner
  console.log('=== Test 1: FileScanner ===');
  const scanner = new FileScanner({
    paths: [path.join(__dirname, 'cars')],
    fileTypes: {
      images: true,
      documents: true,
      spreadsheets: true,
    },
  });

  const files = await scanner.scan();
  console.log(`Found ${files.length} files`);

  const stats = FileScanner.getStats(files);
  console.log('Stats:', stats);
  console.log('');

  // Test 2: VehicleExtractor
  console.log('=== Test 2: VehicleExtractor ===');
  const extractor = new VehicleExtractor();
  const results = await extractor.extractBatch(files);

  let vehicles = results.flatMap(r => r.vehicles);
  console.log(`Extracted ${vehicles.length} vehicles (with duplicates)`);

  vehicles = VehicleExtractor.deduplicate(vehicles);
  console.log(`After deduplication: ${vehicles.length} vehicles`);

  for (const v of vehicles) {
    console.log(`  - ${v.year} ${v.make} ${v.model} (confidence: ${(v.confidence * 100).toFixed(1)}%)`);
  }
  console.log('');

  // Test 3: CsvParser
  console.log('=== Test 3: CsvParser ===');
  const csvParser = new CsvParser();
  const csvVehicles = await csvParser.parse(path.join(__dirname, 'inventory.csv'));
  console.log(`Parsed ${csvVehicles.length} vehicles from CSV`);

  for (const v of csvVehicles.slice(0, 2)) {
    console.log(`  - ${v.year} ${v.make} ${v.model}`);
    console.log(`    VIN: ${v.vin || 'N/A'}`);
    console.log(`    Confidence: ${(v.confidence * 100).toFixed(1)}%`);
  }
  console.log('');

  // Test 4: Merge functionality
  console.log('=== Test 4: Merge Vehicles ===');
  const testVehicles = [
    { year: 1974, make: 'Chevrolet', sourceFile: 'file1.txt', confidence: 0.8 },
    { year: 1974, make: 'Chevrolet', model: 'C10', vin: 'TEST123', sourceFile: 'file2.txt', confidence: 0.9 },
  ];

  const merged = VehicleExtractor.merge(testVehicles);
  console.log('Merged result:', merged);
  console.log('');

  console.log('All tests completed successfully!');
}

testLibrary().catch(console.error);
