#!/usr/bin/env node
/**
 * SECURITY FIX: Remove hardcoded credentials from all scripts
 * This script updates all .js, .cjs, and .mjs files to use environment variables
 */

const fs = require('fs');
const path = require('path');

// Patterns to detect hardcoded credentials (no secrets stored here)
const SUPABASE_SERVICE_KEY_REGEX = /const\s+SUPABASE_SERVICE_KEY\s*=\s*['"][^'"]+['"];/g;
const SUPABASE_URL_REGEX = /const\s+SUPABASE_URL\s*=\s*['"]https:\/\/[a-z0-9-]+\.supabase\.co['"];/g;
const GEMINI_API_KEY_REGEX = /AIza[0-9A-Za-z\-_]{20,}/g;
const FIRECRAWL_API_KEY_REGEX = /fc-[0-9a-f]{30,}/gi;

function fixFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Check if file contains hardcoded credentials
    const hasSupabaseKey = SUPABASE_SERVICE_KEY_REGEX.test(content);
    const hasGeminiKey = GEMINI_API_KEY_REGEX.test(content);
    const hasFirecrawlKey = FIRECRAWL_API_KEY_REGEX.test(content);
    const hasSupabaseUrl = SUPABASE_URL_REGEX.test(content);

    // Reset regex state for subsequent uses
    SUPABASE_SERVICE_KEY_REGEX.lastIndex = 0;
    GEMINI_API_KEY_REGEX.lastIndex = 0;
    FIRECRAWL_API_KEY_REGEX.lastIndex = 0;
    SUPABASE_URL_REGEX.lastIndex = 0;

    if (!hasSupabaseKey && !hasGeminiKey && !hasFirecrawlKey && !hasSupabaseUrl) {
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
    const foundSupabaseUrl = SUPABASE_URL_REGEX.test(content);
    SUPABASE_URL_REGEX.lastIndex = 0;
    if (foundSupabaseUrl) {
      content = content.replace(
        SUPABASE_URL_REGEX,
        "const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';"
      );
      modified = true;
      console.log('  ✓ Fixed SUPABASE_URL');
      SUPABASE_URL_REGEX.lastIndex = 0;
    }
    
    // Replace hardcoded Supabase service key
    const foundSupabaseKey = SUPABASE_SERVICE_KEY_REGEX.test(content);
    SUPABASE_SERVICE_KEY_REGEX.lastIndex = 0;
    if (foundSupabaseKey) {
      content = content.replace(
        SUPABASE_SERVICE_KEY_REGEX,
        "const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;"
      );
      modified = true;
      console.log('  ✓ Removed hardcoded SUPABASE_SERVICE_KEY');
      SUPABASE_SERVICE_KEY_REGEX.lastIndex = 0;
    }
    
    // Replace hardcoded Gemini API key
    const foundGeminiKey = GEMINI_API_KEY_REGEX.test(content);
    GEMINI_API_KEY_REGEX.lastIndex = 0;
    if (foundGeminiKey) {
      content = content.replace(GEMINI_API_KEY_REGEX, "process.env.GEMINI_API_KEY");
      modified = true;
      console.log('  ✓ Removed hardcoded GEMINI_API_KEY');
      GEMINI_API_KEY_REGEX.lastIndex = 0;
    }
    
    // Replace hardcoded Firecrawl API key
    const foundFirecrawlKey = FIRECRAWL_API_KEY_REGEX.test(content);
    FIRECRAWL_API_KEY_REGEX.lastIndex = 0;
    if (foundFirecrawlKey) {
      content = content.replace(FIRECRAWL_API_KEY_REGEX, "process.env.FIRECRAWL_API_KEY");
      modified = true;
      console.log('  ✓ Removed hardcoded FIRECRAWL_API_KEY');
      FIRECRAWL_API_KEY_REGEX.lastIndex = 0;
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

