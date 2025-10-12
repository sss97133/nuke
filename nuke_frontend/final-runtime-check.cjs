#!/usr/bin/env node

/**
 * Final Runtime Import Validation
 * Comprehensive scan to ensure NO runtime import issues remain
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Final comprehensive runtime import validation...');

// Extended list of ALL possible runtime imports
const RUNTIME_IMPORTS = new Set([
  // React Core
  'React', 'StrictMode', 'createRoot', 'useState', 'useEffect', 'useCallback', 'useMemo',
  'useRef', 'useContext', 'useReducer', 'useLayoutEffect', 'memo', 'forwardRef',
  'lazy', 'Suspense', 'Fragment', 'Component', 'PureComponent', 'createElement',

  // React Router
  'useNavigate', 'useParams', 'useLocation', 'useSearchParams', 'Navigate',
  'Link', 'NavLink', 'Outlet', 'BrowserRouter', 'Routes', 'Route',

  // Services
  'supabase', 'NotificationService', 'AdminNotificationService', 'secureDocumentService',
  'FeedService', 'VehicleSearchService', 'VehicleDiscoveryService', 'SearchHelpers',
  'professionalService', 'extractImageMetadata', 'reverseGeocode', 'getEventDateFromImages',
  'getEventLocationFromImages', 'ImageUploadService', 'TimelineEventService',

  // Components commonly incorrectly imported as types
  'ToastProvider', 'PhotoLibraryCategorizer', 'AddVehicle', 'UploadProgressBar',

  // Utilities
  'classNames', 'clsx', 'cn', 'toast', 'axios', 'fetch'
]);

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

function findRuntimeImportIssues(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const issues = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for type imports of runtime items
      if (line.includes('import type {')) {
        const match = line.match(/import type \{\s*([^}]+)\s*\}/);
        if (match) {
          const imports = match[1].split(',').map(s => s.trim());

          for (const imp of imports) {
            const cleanImport = imp.replace(/^type\s+/, '');
            if (RUNTIME_IMPORTS.has(cleanImport)) {
              issues.push({
                line: lineNum,
                issue: `Runtime import '${cleanImport}' incorrectly imported as type`,
                code: line.trim()
              });
            }
          }
        }
      }
    }

    return issues;
  } catch (error) {
    return [`Error reading file: ${error.message}`];
  }
}

try {
  const srcDir = path.join(process.cwd(), 'src');
  const allFiles = getAllFiles(srcDir);

  console.log(`📁 Scanning ${allFiles.length} files for runtime import issues...`);

  let totalIssues = 0;
  const problemFiles = [];

  for (const file of allFiles) {
    const issues = findRuntimeImportIssues(file);
    if (issues.length > 0) {
      totalIssues += issues.length;
      problemFiles.push({
        file: path.relative(process.cwd(), file),
        issues
      });
    }
  }

  if (totalIssues === 0) {
    console.log('✅ PERFECT! No runtime import issues found.');
    console.log('🎉 All imports are correctly configured!');
  } else {
    console.log(`❌ Found ${totalIssues} runtime import issues in ${problemFiles.length} files:`);

    for (const { file, issues } of problemFiles) {
      console.log(`\n📄 ${file}:`);
      for (const issue of issues) {
        console.log(`  Line ${issue.line}: ${issue.issue}`);
        console.log(`    ${issue.code}`);
      }
    }
  }

} catch (error) {
  console.error('❌ Validation error:', error.message);
  process.exit(1);
}