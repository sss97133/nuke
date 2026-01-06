#!/usr/bin/env node

/**
 * Deploy Data Quality Fixes
 * Deploys all the new extraction quality improvements to Supabase
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const FUNCTIONS_TO_DEPLOY = [
  'smart-extraction-router',
  'validate-vehicle-image',
  'extraction-quality-validator'
];

async function deployFunction(functionName) {
  console.log(`📦 Deploying ${functionName}...`);

  try {
    const { stdout, stderr } = await execAsync(`supabase functions deploy ${functionName}`, {
      cwd: process.cwd()
    });

    console.log(`   ✅ ${functionName} deployed successfully`);
    if (stdout) console.log(`   ${stdout.trim()}`);

    return true;
  } catch (error) {
    console.error(`   ❌ Failed to deploy ${functionName}:`);
    console.error(`   ${error.message}`);
    return false;
  }
}

async function testFunction(functionName, testPayload) {
  console.log(`🧪 Testing ${functionName}...`);

  try {
    // Test with a simple payload
    const testCommand = `curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/${functionName}" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d '${JSON.stringify(testPayload)}' \
      --max-time 30 --silent`;

    const { stdout } = await execAsync(testCommand, {
      env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY }
    });

    const response = JSON.parse(stdout);
    if (response.success !== false) {
      console.log(`   ✅ ${functionName} test passed`);
      return true;
    } else {
      console.log(`   ⚠️  ${functionName} test returned: ${response.error || 'unknown error'}`);
      return false;
    }
  } catch (error) {
    console.error(`   ❌ ${functionName} test failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🚀 DEPLOYING DATA QUALITY FIXES');
  console.log('='.repeat(70));

  // Check environment
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set in environment');
    process.exit(1);
  }

  console.log('📋 Functions to deploy:');
  FUNCTIONS_TO_DEPLOY.forEach(fn => console.log(`   - ${fn}`));
  console.log();

  let deployedSuccessfully = 0;
  let testedSuccessfully = 0;

  // Deploy all functions
  console.log('📦 DEPLOYMENT PHASE');
  console.log('-'.repeat(50));

  for (const functionName of FUNCTIONS_TO_DEPLOY) {
    const success = await deployFunction(functionName);
    if (success) deployedSuccessfully++;

    // Short delay between deployments
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n📊 Deployment Results: ${deployedSuccessfully}/${FUNCTIONS_TO_DEPLOY.length} successful\n`);

  if (deployedSuccessfully === 0) {
    console.error('❌ No functions deployed successfully. Check Supabase CLI configuration.');
    process.exit(1);
  }

  // Test deployed functions
  console.log('🧪 TESTING PHASE');
  console.log('-'.repeat(50));

  const testPayloads = {
    'smart-extraction-router': {
      url: 'https://bringatrailer.com/listing/1985-bmw-m635csi-60/',
      fallback_basic: true
    },
    'validate-vehicle-image': {
      image_url: 'https://bringatrailer.com/wp-content/uploads/2025/01/1985_bmw_m635csi_17363750162f52ae0cimg_8901-scaled.jpg?fit=940%2C627',
      expected_vehicle: '1985 BMW M635CSI'
    },
    'extraction-quality-validator': {
      vehicle_data: {
        year: 1985,
        make: 'BMW',
        model: 'M635CSI',
        vin: 'WBAEE310101052137'
      },
      source_type: 'auction'
    }
  };

  for (const functionName of FUNCTIONS_TO_DEPLOY) {
    if (testPayloads[functionName]) {
      const success = await testFunction(functionName, testPayloads[functionName]);
      if (success) testedSuccessfully++;
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n📊 Testing Results: ${testedSuccessfully}/${FUNCTIONS_TO_DEPLOY.length} successful\n`);

  // Final summary and next steps
  console.log('='.repeat(70));
  console.log('📋 DEPLOYMENT COMPLETE');
  console.log('='.repeat(70));

  if (deployedSuccessfully === FUNCTIONS_TO_DEPLOY.length && testedSuccessfully > 0) {
    console.log('✅ All data quality fixes deployed successfully!\n');

    console.log('📋 NEXT STEPS:');
    console.log('1. Update process-import-queue to use smart-extraction-router');
    console.log('2. Run backfill script: node scripts/backfill-bat-specs.js');
    console.log('3. Update your cron jobs to use the new routing logic');
    console.log('4. Monitor extraction quality in Supabase dashboard\n');

    console.log('💡 USAGE EXAMPLES:');
    console.log('// Use smart router instead of direct extraction');
    console.log("const { data } = await supabase.functions.invoke('smart-extraction-router', {");
    console.log("  body: { url: 'https://bringatrailer.com/listing/...', vehicle_id: 'uuid' }");
    console.log('});\n');

    console.log('// Validate extraction before importing');
    console.log("const validation = await supabase.functions.invoke('extraction-quality-validator', {");
    console.log('  body: { vehicle_data: extractedData, source_type: "auction" }');
    console.log('});');

  } else {
    console.log('⚠️  Deployment completed with some issues:');
    console.log(`   - ${deployedSuccessfully}/${FUNCTIONS_TO_DEPLOY.length} functions deployed`);
    console.log(`   - ${testedSuccessfully}/${FUNCTIONS_TO_DEPLOY.length} functions tested successfully`);
    console.log('\n💡 Check Supabase logs for any deployment errors.');
  }
}

main().catch(console.error);