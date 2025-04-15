#!/usr/bin/env node

/**
 * Auto-Fix Supabase Query Patterns Script for Vehicle-Centric Architecture
 * 
 * This script systematically fixes common Supabase query issues including:
 * 1. Multiple .from() calls in the same query chain
 * 2. Missing error handling in Supabase queries
 * 3. Incorrect filter columns in vehicle data queries
 * 4. Broken Supabase storage method chains
 * 5. Unhandled storage operations
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// Support ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);

// File patterns to focus on
const VEHICLE_DATA_PATTERNS = [
  'src/components/VehicleTimeline/**/*.{ts,tsx,js,jsx}',
  'src/components/vehicles/**/*.{ts,tsx,js,jsx}',
  'src/components/marketplace/**/*.{ts,tsx,js,jsx}',
  'src/components/auctions/**/*.{ts,tsx,js,jsx}',
  'src/lib/timeline/**/*.{ts,tsx,js,jsx}',
  'src/services/**/*.{ts,tsx,js,jsx}',
  'src/utils/**/*.{ts,tsx,js,jsx}',
  'src/integrations/**/*.{ts,tsx,js,jsx}',  // Added integrations directory
  'supabase/functions/**/*.{ts,js}'
];

// Common error patterns to fix
const SUPABASE_ERROR_PATTERNS = [
  {
    name: 'Broken storage chains',
    regex: /(const|let|var)?\s*\{\s*(?:data|error)(?:\s*:\s*\w+)?(?:\s*,\s*(?:data|error)(?:\s*:\s*\w+)?)*\s*\}\s*=\s*(?:await\s+)?supabase\.storage[\s\S]*?if\s*\([^)]*\)[^\n;]*?\.from\(["']([\w-]+)["']\)/g,
    fix: (file, content, match) => {
      // Fix broken storage chains (the exact pattern we saw in client.ts)
      return content.replace(match[0], (matched) => {
        // Try to extract the variable declaration, bucket name, and operation
        const declarationMatch = matched.match(/(const|let|var)?\s*\{([^}]*)\}\s*=\s*(await\s+)?supabase\.storage/);
        const bucketMatch = matched.match(/\.from\(["']([\w-]+)["']\)/);
        
        if (declarationMatch && bucketMatch) {
          const [_, declarationType, variables, awaitKeyword] = declarationMatch;
          const bucket = bucketMatch[1];
          
          // Build proper chain structure with vehicle-centric error handling
          return `try {
            ${declarationType || 'const'} {${variables}} = ${awaitKeyword || ''}supabase.storage
              .from("${bucket}")
              .upload(fileName, file, { cacheControl: "3600", upsert: false });
            
            if (error) {
              console.error("Vehicle storage operation error:", error);
              // Track vehicle data failures for the multi-source connector framework
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                  detail: { 
                    vehicleId, 
                    operation: 'storageOperation', 
                    source: '${path.basename(file)}',
                    error,
                    timestamp: new Date().toISOString(),
                    confidence: 0 
                  } 
                }));
              }
            }
          } catch (storageError) {
            console.error("Unexpected storage error:", storageError);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                detail: { 
                  source: '${path.basename(file)}', 
                  operation: 'storageOperation',
                  error: storageError, 
                  timestamp: new Date().toISOString(),
                  confidence: 0 
                } 
              }));
            }
          }`;
        }
        
        return matched;
      });
    }
  },
  {
    name: 'Unhandled storage operations',
    regex: /(const|let|var)?\s*\{\s*(?:data|error)(?:\s*:\s*\w+)?(?:\s*,\s*(?:data|error)(?:\s*:\s*\w+)?)*\s*\}\s*=\s*(?:await\s+)?supabase\.storage\.from\(["'][\w-]+["']\)\.\w+\([^\)]*\)(?![\s\S]*?if\s*\(\s*error\s*\))/g,
    fix: (file, content, match) => {
      // Add vehicle-centric error handling to Supabase storage operations
      return content.replace(match[0], (matched) => {
        // Check if already in a try block
        const prevContext = content.substring(
          Math.max(0, content.indexOf(matched) - 50),
          content.indexOf(matched)
        );
        
        if (prevContext.includes('try {')) {
          return matched; // Already in a try block, don't modify
        }
        
        // Extract operation type if possible
        const operationMatch = matched.match(/\.from\(["'][\w-]+["']\)\.(\w+)/);
        const operation = operationMatch ? operationMatch[1] : 'storageOperation';
        
        // Add vehicle-centric error handling with confidence scoring for data reliability
        return `try {
          ${matched}
          
          if (error) {
            console.error("Vehicle ${operation} operation failed:", error);
            // Track vehicle data failures for the multi-source connector framework
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                detail: { 
                  operation: '${operation}', 
                  source: '${path.basename(file)}',
                  error,
                  timestamp: new Date().toISOString() 
                } 
              }));
            }
            return { error, data: null, confidence: 0 };
          }
        } catch (storageError) {
          console.error("Unexpected vehicle storage error:", storageError);
          // Add vehicle data error tracking for reliability metrics
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
              detail: { 
                source: '${path.basename(file)}', 
                operation: '${operation}',
                error: storageError, 
                timestamp: new Date().toISOString() 
              } 
            }));
          }
          return { error: storageError, data: null, confidence: 0 };
        }`;
      });
    }
  },
  {
    name: 'Multiple from() calls',
    regex: /\.from\(['"]\w+['"]\)[.\s\n\r]+((?!\.from\(['"])\w+[.\s\n\r]+)*\.from\(['"]\w+['"]\)/g,
    fix: (file, content, match) => {
      // Replace multiple .from() calls with proper joins
      return content.replace(match[0], (matched) => {
        // Extract the table names
        const tableRegex = /\.from\(['"](\w+)['"]\)/g;
        const tables = [...matched.matchAll(tableRegex)].map(m => m[1]);
        
        if (tables.length >= 2) {
          // Create a join instead of multiple .from() calls
          const primaryTable = tables[0];
          const secondaryTable = tables[1];
          
          // Extract the operations between from() calls
          const betweenFroms = matched.split(`.from('${secondaryTable}')`)[0]
            .split(`.from('${primaryTable}')`)[1];
          
          return `.from('${primaryTable}')
            .select('*, ${secondaryTable}(*)')
            .inner_join('${secondaryTable}', 'id', '${primaryTable}_id')${betweenFroms}`;
        }
        
        return matched;
      });
    }
  },
  {
    name: 'Missing error handling',
    regex: /(const|let|var)?\s*\w+\s*=\s*await\s+\w+\.from\(['"]\w+['"]\)[\s\S]*?(?!\.catch\(|try\s*{)/g,
    fix: (file, content, match) => {
      // Add error handling to Supabase query
      return content.replace(match[0], (matched) => {
        // Check if already in a try block
        const prevContext = content.substring(
          Math.max(0, content.indexOf(matched) - 50),
          content.indexOf(matched)
        );
        
        if (prevContext.includes('try {')) {
          // Already in a try block, modify to ensure catch block exists
          const nextContext = content.substring(
            content.indexOf(matched) + matched.length,
            Math.min(content.length, content.indexOf(matched) + matched.length + 100)
          );
          
          if (!nextContext.includes('catch')) {
            // Add catch block after the try block ends
            const tryBlockEndIndex = content.indexOf('}', content.indexOf(matched) + matched.length);
            if (tryBlockEndIndex !== -1) {
              // Add vehicle-centric error handling with confidence scoring for data reliability
              return matched + content.substring(content.indexOf(matched) + matched.length, tryBlockEndIndex + 1) +
                ` catch (error) {
                  console.error('Vehicle data operation failed:', error);
                  // Add vehicle data error tracking for reliability metrics
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                      detail: { source: '${path.basename(file)}', timestamp: new Date().toISOString(), error } 
                    }));
                  }
                  return { error, data: null, confidence: 0 };
                }`;
            }
          }
          return matched;
        }
        
        // Wrap in try-catch if not already in one - with vehicle-specific error handling
        if (matched.includes('await')) {
          // Extract the variable declaration if it exists
          const declarationMatch = matched.match(/(const|let|var)?\s*(\w+)\s*=\s*(await\s+)?\w+\.from/);
          if (declarationMatch) {
            const [_, declarationType, variableName, awaitKeyword] = declarationMatch;
            
            return `try {
              ${matched}
              
              if (${variableName}.error) {
                console.error("Vehicle data operation failed:", ${variableName}.error);
                // Track vehicle data failures for the multi-source connector framework
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                    detail: { 
                      source: '${path.basename(file)}', 
                      operation: 'databaseQuery',
                      error: ${variableName}.error, 
                      timestamp: new Date().toISOString() 
                    } 
                  }));
                }
                return { error: ${variableName}.error, data: null, confidence: 0 };
              }
            } catch (error) {
              console.error("Unexpected vehicle data error:", error);
              // Add vehicle data error tracking for reliability metrics
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                  detail: { 
                    source: '${path.basename(file)}', 
                    operation: 'databaseQuery',
                    error, 
                    timestamp: new Date().toISOString() 
                  } 
                }));
              }
              return { error, data: null, confidence: 0 };
            }`;
          }
        }
        
        return matched;
      });
    }
  },
  {
    name: 'Incorrect filter column',
    regex: /\.filter\(['"](status|state)['"]\s*,\s*['"](\w+)['"]\)/g,
    fix: (file, content, match) => {
      // Replace deprecated filter columns with the standard ones
      return content.replace(match[0], (matched) => {
        // Extract filter parameters
        const filterMatch = matched.match(/\.filter\(['"](\w+)['"]\s*,\s*['"](\w+)['"]\)/)
        if (filterMatch) {
          const [_, column, value] = filterMatch;
          // Map deprecated columns to correct ones in the vehicle schema
          const columnMap = { 'status': 'vehicle_status', 'state': 'vehicle_state' };
          return `.filter('${columnMap[column] || column}', '${value}')`;
        }
        return matched;
      });
    }
  },
  {
    name: 'Inefficient error handling',
    regex: /\n\s*try\s*{\s*\n\s*.*\n\s*}\s*catch\s*\(\w+\)\s*{\s*\n\s*console\.error\([^)]*\);\s*\n\s*}/g,
    fix: (file, content, match) => {
      // Enhance inefficient error handling with vehicle-centric standardized approach
      return content.replace(match[0], (matched) => {
        // Extract variable name from the catch block
        const errorVarMatch = matched.match(/catch\s*\((\w+)\)/);
        if (errorVarMatch) {
          const errorVar = errorVarMatch[1];
          return matched.replace(/console\.error\([^)]*\);/, 
            `console.error("Vehicle data operation failed:", ${errorVar});
            // Track vehicle data failures for the multi-source connector framework
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('vehicle-data-error', { 
                detail: { 
                  source: '${path.basename(file)}', 
                  error: ${errorVar}, 
                  timestamp: new Date().toISOString(),
                  confidence: 0
                } 
              }));
            }
            return { error: ${errorVar}, data: null, confidence: 0 };`
          );
        }
        return matched;
      });
    }
  }
];

// Process a single file
function processFile(filePath) {
  console.log(`📄 Processing ${filePath}...`);
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;
    let fixes = 0;
    
    // Apply each fix pattern
    for (const pattern of SUPABASE_ERROR_PATTERNS) {
      // Find all matches in the file
      const matches = [...content.matchAll(pattern.regex)];
      if (matches.length > 0) {
        console.log(`  🔍 Found ${matches.length} instance(s) of ${pattern.name}`);
        
        // Apply fixes
        content = pattern.fix(filePath, content, matches);
        fixes += matches.length;
      }
    }
    
    // Only write if changes were made
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`  ✅ Fixed ${fixes} issue(s) in ${filePath}`);
      return fixes;
    } else {
      console.log(`  ✓ No fixes needed in ${filePath}`);
      return 0;
    }
  } catch (error) {
    console.error(`  ❌ Error processing ${filePath}: ${error.message}`);
    return 0;
  }
}

// Get files to process based on grep search for Supabase patterns
function findFilesWithSupabaseOperations() {
  // Use simpler patterns that are compatible with command-line grep
  const patterns = [
    // Basic pattern for Supabase database query operations
    'supabase.from',
    // Basic pattern for Supabase storage operations
    'supabase.storage',
    // Basic pattern for destructuring data/error from Supabase
    '{data,error}',
    // Alternative destructuring pattern
    '{error,data}'
  ];
  
  const files = new Set();
  
  for (const pattern of patterns) {
    try {
      // Look for potentially problematic Supabase operations in vehicle-related files
      const vehicleDirs = [
        './src/components/VehicleTimeline',
        './src/components/vehicles',
        './src/components/marketplace',
        './src/components/auctions',
        './src/integrations/supabase',
        './src/lib/timeline',
        './src/utils',
        './src/services',
        './supabase/functions'
      ];
      
      for (const dir of vehicleDirs) {
        if (!fs.existsSync(dir)) continue;
        
        // Use fixed string pattern matching (-F) to avoid regex interpretation
        const grepCmd = `grep -F -r --include="*.{ts,tsx,js,jsx}" -l "${pattern}" ${dir}`;
        try {
          const output = execSync(grepCmd, { encoding: 'utf8' }).trim();
          if (output) {
            output.split('\n').forEach(file => files.add(file));
          }
        } catch (e) {
          // grep returns non-zero exit code when no matches are found, which is not an error for us
        }
      }
    } catch (error) {
      console.error(`Warning: Error finding files with pattern '${pattern}':`, error.message);
    }
  }
  
  const fileArray = Array.from(files);
  if (fileArray.length > 0) {
    console.log(`🔍 Found ${fileArray.length} files with Supabase operations`);
  }
  
  return fileArray;
}

// Main function
async function main() {
  // Get the root of the git repository
  let repoRoot;
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    console.log(`📂 Repository root: ${repoRoot}`);
  } catch (error) {
    console.error('❌ Error getting repository root:', error.message);
    return;
  }
  
  // Change to repository root
  process.chdir(repoRoot);
  
  // Directly specify the key files we know need fixing
  // These files are important for the vehicle-centric architecture
  const filesToProcess = [
    // Key vehicle timeline component files
    './src/components/VehicleTimeline/index.tsx',
    './src/components/VehicleTimeline/useTimelineActions.ts',
    // Supabase integration files
    './src/integrations/supabase/client.ts',
    // Vehicle-related components
    './src/components/vehicles/VehicleForm.tsx',
    // Multi-source connector framework files
    './src/lib/timeline/timeline-service.js',
    // Other key files with Supabase operations
    './src/components/auctions/AuctionList.tsx',
    './src/components/marketplace/hooks/useMarketplaceListing.tsx',
    './src/utils/systemMetrics.ts'
  ].filter(file => fs.existsSync(file)); // Only include files that exist
  
  console.log(`📄 Targeting ${filesToProcess.length} critical files for vehicle data operations`);
  
  if (filesToProcess.length === 0) {
    console.log('⚠️ No critical files found to process');
    return;
  }
  
  console.log(`🔍 Processing ${filesToProcess.length} files...`);
  
  // Process each file
  let totalFixes = 0;
  for (const file of filesToProcess) {
    totalFixes += processFile(file);
  }
  
  console.log(`\n📊 Summary: Fixed ${totalFixes} Supabase query issues in ${filesToProcess.length} files`);
  
  // Run validation again to check if we fixed the issues
  try {
    execSync('cd "$(git rev-parse --show-toplevel)" && node scripts/validate-supabase-queries.mjs --check', 
              { encoding: 'utf8', stdio: 'inherit' });
    console.log('🎉 Supabase query validation successful!');
  } catch (e) {
    console.log('⚠️ Some Supabase query issues remain. Manual fixes may be required.');
    console.log('Run the validation script for more details:');
    console.log('  node scripts/validate-supabase-queries.mjs');
  }
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
