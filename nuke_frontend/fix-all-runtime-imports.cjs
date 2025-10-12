#!/usr/bin/env node

/**
 * Comprehensive Runtime Import Fix
 * Finds and fixes ALL runtime imports incorrectly marked as type imports
 */

const fs = require('fs');
const path = require('path');

console.log('🔧 Comprehensive runtime import fix...');

// Common runtime imports that should NEVER be type imports
const RUNTIME_IMPORTS = new Set([
  // React
  'StrictMode', 'createRoot', 'useState', 'useEffect', 'useCallback', 'useMemo',
  'useRef', 'useContext', 'useReducer', 'useLayoutEffect', 'memo', 'forwardRef',
  'lazy', 'Suspense', 'Fragment', 'Component', 'PureComponent', 'createElement',

  // React Router
  'useNavigate', 'useParams', 'useLocation', 'useSearchParams', 'Navigate',
  'Link', 'NavLink', 'Outlet', 'BrowserRouter', 'Routes', 'Route',

  // Services and utilities
  'supabase', 'NotificationService', 'AdminNotificationService', 'secureDocumentService',
  'FeedService', 'VehicleSearchService', 'VehicleDiscoveryService', 'SearchHelpers',
  'professionalService', 'extractImageMetadata', 'reverseGeocode', 'getEventDateFromImages',
  'getEventLocationFromImages', 'ImageUploadService', 'TimelineEventService',

  // Common utilities
  'classNames', 'clsx', 'cn', 'toast', 'axios', 'fetch'
]);

// File extensions to process
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function getAllFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
      files.push(...getAllFiles(fullPath));
    } else if (item.isFile() && EXTENSIONS.some(ext => item.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

function fixRuntimeImports(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;
    const changes = [];

    // Split into lines for processing
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Pattern 1: Pure type imports that contain runtime imports
      // import type { useNavigate, StrictMode } from 'module'
      if (line.includes('import type {') && !line.includes(', type ')) {
        const match = line.match(/import type \{\s*([^}]+)\s*\}/);
        if (match) {
          const imports = match[1].split(',').map(s => s.trim());
          const hasRuntimeImport = imports.some(imp => RUNTIME_IMPORTS.has(imp));

          if (hasRuntimeImport) {
            lines[i] = line.replace('import type {', 'import {');
            hasChanges = true;
            changes.push(`Fixed pure type import: ${imports.join(', ')}`);
          }
        }
      }

      // Pattern 2: Mixed imports with incorrect type modifiers
      // import type { Service, type TypeName } -> import { Service, type TypeName }
      else if (line.includes('import type {') && line.includes(', type ')) {
        const match = line.match(/import type \{\s*([^}]+)\s*\}/);
        if (match) {
          const imports = match[1].split(',').map(s => s.trim());
          const hasRuntimeImport = imports.some(imp =>
            !imp.startsWith('type ') && RUNTIME_IMPORTS.has(imp)
          );

          if (hasRuntimeImport) {
            lines[i] = line.replace('import type {', 'import {');
            hasChanges = true;
            changes.push(`Fixed mixed type import: ${imports.join(', ')}`);
          }
        }
      }

      // Pattern 3: Individual type imports that should be runtime
      // import type { useNavigate } from 'react-router-dom'
      else if (line.match(/^import type \{ \w+ \}/)) {
        const match = line.match(/import type \{\s*(\w+)\s*\}/);
        if (match && RUNTIME_IMPORTS.has(match[1])) {
          lines[i] = line.replace('import type {', 'import {');
          hasChanges = true;
          changes.push(`Fixed single type import: ${match[1]}`);
        }
      }
    }

    if (hasChanges) {
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      console.log(`✅ Fixed: ${path.relative(process.cwd(), filePath)}`);
      changes.forEach(change => console.log(`   ${change}`));
      return true;
    }

    return false;
  } catch (error) {
    console.log(`❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

try {
  const srcDir = path.join(process.cwd(), 'src');
  const allFiles = getAllFiles(srcDir);

  console.log(`🔍 Scanning ${allFiles.length} files...`);

  let fixedCount = 0;

  for (const file of allFiles) {
    if (fixRuntimeImports(file)) {
      fixedCount++;
    }
  }

  console.log(`\n✅ Fixed ${fixedCount} files with runtime import issues`);
  console.log('🎉 All runtime import errors should now be resolved!');

} catch (error) {
  console.error('❌ Error during fix:', error.message);
  process.exit(1);
}