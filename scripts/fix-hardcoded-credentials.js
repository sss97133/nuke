#!/usr/bin/env node
/**
 * SECURITY FIX: Remove hardcoded credentials from all scripts
 * This script updates all .js, .cjs, and .mjs files to use environment variables
 */

const fs = require('fs');
const path = require('path');

// Sensitive credentials to remove
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';
const GEMINI_API_KEY = 'AIzaSyCTXqzxp5oRPoW745dHZjGDQ2yFOd4fvDQ';
const FIRECRAWL_API_KEY = 'fc-12e25be3d7664da4984cd499adff7dc4';

function fixFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Check if file contains hardcoded credentials
    if (!content.includes(SUPABASE_SERVICE_KEY) && 
        !content.includes(GEMINI_API_KEY) && 
        !content.includes(FIRECRAWL_API_KEY)) {
      return false;
    }
    
    console.log(`\n🔧 Fixing: ${path.relative(process.cwd(), filePath)}`);
    
    // Add dotenv if not present
    if (!content.includes("require('dotenv')")) {
      const lines = content.split('\n');
      const firstRequireIndex = lines.findIndex(line => line.includes("require('"));
      
      if (firstRequireIndex !== -1) {
        lines.splice(firstRequireIndex, 0, "require('dotenv').config();");
        content = lines.join('\n');
        modified = true;
        console.log('  ✓ Added dotenv import');
      }
    }
    
    // Replace hardcoded Supabase URL
    if (content.includes("const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co'")) {
      content = content.replace(
        /const SUPABASE_URL = 'https:\/\/qkgaybvrernstplzjaam\.supabase\.co';/g,
        "const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';"
      );
      modified = true;
      console.log('  ✓ Fixed SUPABASE_URL');
    }
    
    // Replace hardcoded Supabase service key
    if (content.includes(SUPABASE_SERVICE_KEY)) {
      content = content.replace(
        new RegExp(`const SUPABASE_SERVICE_KEY = '${SUPABASE_SERVICE_KEY}';`, 'g'),
        "const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;"
      );
      modified = true;
      console.log('  ✓ Removed hardcoded SUPABASE_SERVICE_KEY');
    }
    
    // Replace hardcoded Gemini API key
    if (content.includes(GEMINI_API_KEY)) {
      content = content.replace(
        new RegExp(`const GEMINI_API_KEY = '${GEMINI_API_KEY}';`, 'g'),
        "const GEMINI_API_KEY = process.env.GEMINI_API_KEY;"
      );
      modified = true;
      console.log('  ✓ Removed hardcoded GEMINI_API_KEY');
    }
    
    // Replace hardcoded Firecrawl API key
    if (content.includes(FIRECRAWL_API_KEY)) {
      content = content.replace(
        new RegExp(`const FIRECRAWL_API_KEY = '${FIRECRAWL_API_KEY}';`, 'g'),
        "const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;"
      );
      modified = true;
      console.log('  ✓ Removed hardcoded FIRECRAWL_API_KEY');
    }
    
    // Add validation for required environment variables (after imports, before main logic)
    const needsSupabaseValidation = content.includes('SUPABASE_SERVICE_KEY') && 
                                    !content.includes('if (!SUPABASE_SERVICE_KEY)');
    const needsGeminiValidation = content.includes('GEMINI_API_KEY') && 
                                  !content.includes('if (!GEMINI_API_KEY)');
    const needsFirecrawlValidation = content.includes('FIRECRAWL_API_KEY') && 
                                     !content.includes('if (!FIRECRAWL_API_KEY)');
    
    if (needsSupabaseValidation || needsGeminiValidation || needsFirecrawlValidation) {
      const validationCode = [];
      
      if (needsSupabaseValidation) {
        validationCode.push(
          `if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {`,
          `  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');`,
          `  process.exit(1);`,
          `}`
        );
      }
      
      if (needsGeminiValidation) {
        validationCode.push(
          `if (!GEMINI_API_KEY) {`,
          `  console.error('ERROR: GEMINI_API_KEY environment variable is required');`,
          `  process.exit(1);`,
          `}`
        );
      }
      
      if (needsFirecrawlValidation) {
        validationCode.push(
          `if (!FIRECRAWL_API_KEY) {`,
          `  console.error('ERROR: FIRECRAWL_API_KEY environment variable is required');`,
          `  process.exit(1);`,
          `}`
        );
      }
      
      // Find the line after createClient or first function
      const lines = content.split('\n');
      const supabaseClientIndex = lines.findIndex(line => line.includes('createClient(SUPABASE_URL'));
      
      if (supabaseClientIndex !== -1) {
        lines.splice(supabaseClientIndex, 0, '', ...validationCode, '');
        content = lines.join('\n');
        modified = true;
        console.log('  ✓ Added environment variable validation');
      }
    }
    
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`  ✗ Error fixing ${filePath}:`, error.message);
    return false;
  }
}

function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  let fixedCount = 0;
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules and other directories
      if (!['node_modules', '.git', 'archive', 'tmp'].includes(file)) {
        fixedCount += scanDirectory(filePath);
      }
    } else if (file.match(/\.(js|cjs|mjs)$/) && !file.includes('fix-hardcoded-credentials')) {
      if (fixFile(filePath)) {
        fixedCount++;
      }
    }
  }
  
  return fixedCount;
}

console.log('🔒 SECURITY FIX: Removing hardcoded credentials from scripts...\n');
console.log('=' .repeat(60));

const scriptsDir = path.join(__dirname);
const fixedCount = scanDirectory(scriptsDir);

console.log('\n' + '='.repeat(60));
console.log(`✅ Fixed ${fixedCount} files`);
console.log('\nNOTE: Make sure your .env file contains:');
console.log('  - VITE_SUPABASE_URL');
console.log('  - SUPABASE_SERVICE_ROLE_KEY');
console.log('  - GEMINI_API_KEY');
console.log('  - FIRECRAWL_API_KEY');

