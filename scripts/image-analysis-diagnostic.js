#!/usr/bin/env node

/**
 * IMAGE ANALYSIS DIAGNOSTIC TOOL
 * 
 * Comprehensive diagnostic to test all image analysis components:
 * 1. API Keys validation
 * 2. Edge Function connectivity
 * 3. Database state
 * 4. End-to-end image analysis
 * 5. Progress monitoring
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    break;
  }
}

const config = {
  supabaseUrl: envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  supabaseKey: envConfig.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  openaiKey: envConfig.VITE_OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsRegion: process.env.AWS_REGION || 'us-east-1'
};

// Don't create client until we verify keys exist
let supabase = null;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, symbol, message) {
  console.log(`${colors[color]}${symbol}${colors.reset} ${message}`);
}

function section(title) {
  console.log(`\n${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}\n`);
}

function subsection(title) {
  console.log(`\n${colors.bright}${colors.blue}${title}${colors.reset}`);
  console.log(`${colors.blue}${'-'.repeat(80)}${colors.reset}`);
}

async function checkAPIKeys() {
  section('1. API KEYS VALIDATION');
  
  const checks = [
    { name: 'Supabase URL', value: config.supabaseUrl, required: true },
    { name: 'Supabase Service Key', value: config.supabaseKey, required: true },
    { name: 'OpenAI API Key', value: config.openaiKey, required: true },
    { name: 'AWS Access Key ID', value: config.awsAccessKeyId, required: false },
    { name: 'AWS Secret Access Key', value: config.awsSecretAccessKey, required: false },
    { name: 'AWS Region', value: config.awsRegion, required: false }
  ];
  
  let allValid = true;
  let hasRequiredKeys = true;
  
  for (const check of checks) {
    if (check.value) {
      const masked = check.value.substring(0, 8) + '...' + check.value.substring(check.value.length - 4);
      log('green', '✓', `${check.name}: ${masked}`);
    } else if (check.required) {
      log('red', '✗', `${check.name}: MISSING`);
      allValid = false;
      hasRequiredKeys = false;
    } else {
      log('yellow', '!', `${check.name}: Not configured (optional - tested via Edge Function)`);
    }
  }
  
  if (!hasRequiredKeys) {
    console.log(`\n${colors.red}Missing required environment variables!${colors.reset}`);
    console.log(`\n${colors.yellow}Please set these in one of:${colors.reset}`);
    console.log('  • /Users/skylar/nuke/nuke_frontend/.env.local');
    console.log('  • /Users/skylar/nuke/.env.local');
    console.log('  • /Users/skylar/nuke/.env');
    console.log(`\n${colors.yellow}Example:${colors.reset}`);
    console.log('VITE_SUPABASE_URL=https://your-project.supabase.co');
    console.log('SUPABASE_SERVICE_ROLE_KEY=your-service-role-key');
    console.log('VITE_OPENAI_API_KEY=sk-proj-your-key\n');
  }
  
  // Initialize Supabase client if we have the keys
  if (config.supabaseUrl && config.supabaseKey) {
    supabase = createClient(config.supabaseUrl, config.supabaseKey);
  }
  
  return allValid;
}

async function testOpenAI() {
  subsection('Testing OpenAI API via Edge Function');
  
  // We'll test OpenAI through the edge function since we don't need the SDK locally
  log('blue', 'ℹ', 'OpenAI will be tested via Edge Function (see section 3)');
  return true;
}

async function testAWSRekognition() {
  subsection('Testing AWS Rekognition via Edge Function');
  
  // We'll test AWS through the edge function since we don't need the SDK locally
  log('blue', 'ℹ', 'AWS Rekognition will be tested via Edge Function (see section 3)');
  return true;
}

async function checkDatabaseState() {
  section('2. DATABASE STATE');
  
  // Count total images
  const { count: totalImages } = await supabase
    .from('vehicle_images')
    .select('id', { count: 'exact', head: true });
  
  // Count processed images (have scanned_at timestamp)
  const { data: allImages } = await supabase
    .from('vehicle_images')
    .select('ai_scan_metadata');
  
  let processedCount = 0;
  let hasRekognition = 0;
  let hasAppraiser = 0;
  let hasSPID = 0;
  
  allImages?.forEach(img => {
    const metadata = img.ai_scan_metadata;
    if (metadata && typeof metadata === 'object' && metadata.scanned_at) {
      processedCount++;
      if (metadata.rekognition) hasRekognition++;
      if (metadata.appraiser) hasAppraiser++;
      if (metadata.spid) hasSPID++;
    }
  });
  
  const unprocessed = totalImages - processedCount;
  const processedPercent = totalImages > 0 ? ((processedCount / totalImages) * 100).toFixed(2) : '0.00';
  
  log('blue', 'ℹ', `Total images: ${totalImages}`);
  log(processedCount > 0 ? 'green' : 'yellow', processedCount > 0 ? '✓' : '!', 
      `Processed: ${processedCount} (${processedPercent}%)`);
  log(unprocessed > 0 ? 'yellow' : 'green', unprocessed > 0 ? '!' : '✓', 
      `Unprocessed: ${unprocessed}`);
  log('blue', 'ℹ', `With Rekognition data: ${hasRekognition}`);
  log('blue', 'ℹ', `With Appraiser data: ${hasAppraiser}`);
  log('blue', 'ℹ', `With SPID data: ${hasSPID}`);
  
  // Check image_tags table
  const { count: tagCount } = await supabase
    .from('image_tags')
    .select('id', { count: 'exact', head: true });
  
  log('blue', 'ℹ', `Image tags created: ${tagCount || 0}`);
  
  return {
    total: totalImages,
    processed: processedCount,
    unprocessed,
    hasRekognition,
    hasAppraiser,
    hasSPID,
    tagCount: tagCount || 0
  };
}

async function testEdgeFunction() {
  section('3. EDGE FUNCTION CONNECTIVITY');
  
  // Get a test image
  const { data: testImage } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id')
    .limit(1)
    .single();
  
  if (!testImage) {
    log('yellow', '!', 'No images in database to test with');
    return false;
  }
  
  log('blue', 'ℹ', `Testing with image: ${testImage.id}`);
  log('blue', 'ℹ', `Vehicle ID: ${testImage.vehicle_id}`);
  
  try {
    const startTime = Date.now();
    const { data, error } = await supabase.functions.invoke('analyze-image', {
      body: {
        image_url: testImage.image_url,
        vehicle_id: testImage.vehicle_id
      }
    });
    
    const duration = Date.now() - startTime;
    
    if (error) {
      log('red', '✗', `Edge function error: ${error.message}`);
      return false;
    }
    
    log('green', '✓', `Edge function responded in ${duration}ms`);
    
    if (data.success) {
      log('green', '✓', `Analysis successful`);
      log('blue', 'ℹ', `Tags generated: ${data.tags?.length || 0}`);
      
      // Verify data was saved
      const { data: updatedImage } = await supabase
        .from('vehicle_images')
        .select('ai_scan_metadata')
        .eq('id', testImage.id)
        .single();
      
      const metadata = updatedImage?.ai_scan_metadata || {};
      
      if (metadata.scanned_at) {
        log('green', '✓', 'Data saved to database');
        log('blue', 'ℹ', `Rekognition: ${metadata.rekognition ? 'Yes' : 'No'}`);
        log('blue', 'ℹ', `Appraiser: ${metadata.appraiser ? 'Yes' : 'No'}`);
        log('blue', 'ℹ', `SPID: ${metadata.spid ? 'Yes' : 'No'}`);
      } else {
        log('yellow', '!', 'Data may not have been saved correctly');
      }
      
      return true;
    } else {
      log('yellow', '!', 'Function responded but analysis was not successful');
      return false;
    }
  } catch (error) {
    log('red', '✗', `Exception: ${error.message}`);
    return false;
  }
}

async function generateReport(dbState, testsPass) {
  section('4. DIAGNOSTIC SUMMARY');
  
  console.log(`${colors.bright}Overall Status:${colors.reset}`);
  
  if (testsPass.apiKeys && testsPass.openai && testsPass.aws && testsPass.edgeFunction) {
    log('green', '✓', 'ALL SYSTEMS OPERATIONAL');
    console.log('\n' + colors.green + 'Your image analysis pipeline is working correctly!' + colors.reset);
    console.log(colors.green + 'You can now process images in batch.' + colors.reset);
  } else {
    log('red', '✗', 'ISSUES DETECTED');
    console.log('\n' + colors.red + 'Some components are not working:' + colors.reset);
    
    if (!testsPass.apiKeys) log('red', '  •', 'API keys are missing or invalid');
    if (!testsPass.openai) log('red', '  •', 'OpenAI API is not accessible');
    if (!testsPass.aws) log('red', '  •', 'AWS Rekognition is not accessible');
    if (!testsPass.edgeFunction) log('red', '  •', 'Edge function is not working');
  }
  
  console.log(`\n${colors.bright}Database Stats:${colors.reset}`);
  log('blue', '•', `Total images: ${dbState.total}`);
  log('blue', '•', `Processed: ${dbState.processed} (${((dbState.processed/dbState.total)*100).toFixed(1)}%)`);
  log('blue', '•', `Remaining: ${dbState.unprocessed}`);
  
  if (dbState.unprocessed > 0 && testsPass.edgeFunction) {
    console.log(`\n${colors.bright}Next Steps:${colors.reset}`);
    log('cyan', '➜', 'Run batch processing:');
    console.log('   ' + colors.bright + 'node scripts/batch-process-images.js' + colors.reset);
    log('cyan', '➜', 'Monitor progress:');
    console.log('   ' + colors.bright + 'node scripts/image-analysis-monitor.js' + colors.reset);
  }
  
  console.log('\n');
}

async function main() {
  console.log(`${colors.bright}${colors.magenta}`);
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                     IMAGE ANALYSIS DIAGNOSTIC TOOL                         ║');
  console.log('║                                                                            ║');
  console.log('║  This tool checks all components of your image analysis pipeline          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  console.log(colors.reset);
  
  const testsPass = {
    apiKeys: false,
    openai: false,
    aws: false,
    edgeFunction: false
  };
  
  // 1. Check API keys
  testsPass.apiKeys = await checkAPIKeys();
  
  if (!testsPass.apiKeys) {
    log('red', '✗', 'Cannot proceed without valid API keys');
    process.exit(1);
  }
  
  // 2. Test external APIs
  section('2. EXTERNAL API TESTING');
  testsPass.openai = await testOpenAI();
  testsPass.aws = await testAWSRekognition();
  
  // 3. Check database state
  const dbState = await checkDatabaseState();
  
  // 4. Test edge function
  if (dbState.total > 0) {
    testsPass.edgeFunction = await testEdgeFunction();
  } else {
    log('yellow', '!', 'No images in database to test edge function');
  }
  
  // 5. Generate report
  await generateReport(dbState, testsPass);
}

main().catch(err => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, err);
  process.exit(1);
});

