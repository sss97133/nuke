#!/usr/bin/env node

import { PathParser } from '../dist/parsers/path.js';

const parser = new PathParser();

const testPaths = [
  '/Users/john/Cars/1974 Chevrolet C10/receipts/oil_change.pdf',
  '/Users/john/Documents/1987_porsche_911_turbo_service.pdf',
  '/Photos/2015-tesla-model-s-white-5YJSA1E14FF123456.jpg',
  '/garage/1969 Ford Mustang Boss 302/engine_rebuild_notes.txt',
  '/random/path/without/vehicle/info.pdf',
  '/vehicles/Chevy_Corvette_1967/exterior_photos/IMG_0001.jpg',
];

console.log('Testing Path Parser\n');

for (const path of testPaths) {
  const result = parser.parse(path);
  console.log(`Path: ${path}`);
  console.log(`Result:`, result);
  console.log('');
}
