#!/usr/bin/env node

/**
 * Final Import Fix
 * Fixes all remaining import type issues systematically
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Final comprehensive import fix...');

// List of known runtime (non-type) imports that were incorrectly converted
const RUNTIME_IMPORTS = new Set([
  'useNavigate', 'supabase', 'NotificationService', 'AdminNotificationService',
  'secureDocumentService', 'FeedService', 'VehicleSearchService', 'VehicleDiscoveryService',
  'SearchHelpers', 'professionalService', 'extractImageMetadata', 'reverseGeocode',
  'getEventDateFromImages', 'getEventLocationFromImages', 'ImageUploadService'
]);

function fixImportsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;

    // Split into lines for easier processing
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern 1: Fix pure type imports that contain runtime imports
      // import type { useNavigate } -> import { useNavigate }
      if (line.includes('import type {') && !line.includes(', type ')) {
        const match = line.match(/import type \{\s*([^}]+)\s*\}/);
        if (match) {
          const imports = match[1].split(',').map(s => s.trim());
          const hasRuntimeImport = imports.some(imp => RUNTIME_IMPORTS.has(imp));

          if (hasRuntimeImport) {
            lines[i] = line.replace('import type {', 'import {');
            hasChanges = true;
            console.log(`  Fixed pure type import: ${imports.join(', ')}`);
          }
        }
      }
    }

    if (hasChanges) {
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      return true;
    }

    return false;
  } catch (error) {
    console.log(`❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

// Get specific problematic files from the error output
const problematicFiles = [
  'src/pages/Dashboard.tsx',
  'src/pages/AllVehicles.tsx',
  'src/pages/AdminVerifications.tsx',
  'src/pages/LiveFeed.tsx',
  'src/pages/BrowseProfessionals.tsx',
  'src/components/NotificationCenter.tsx',
  'src/components/AdminNotificationCenter.tsx',
  'src/components/UniversalImageUpload.tsx'
];

let fixedCount = 0;

for (const file of problematicFiles) {
  const fullPath = path.join(process.cwd(), file);
  if (fs.existsSync(fullPath)) {
    console.log(`\n🔍 Processing: ${file}`);
    if (fixImportsInFile(fullPath)) {
      fixedCount++;
      console.log(`✅ Fixed: ${file}`);
    } else {
      console.log(`ℹ️  No changes needed: ${file}`);
    }
  }
}

console.log(`\n✅ Fixed ${fixedCount} files`);
console.log('🎉 Import fix complete - the dev server should now work properly!');