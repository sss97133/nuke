#!/usr/bin/env node

/**
 * Master script that runs all vehicle fix scripts in sequence
 * Fixes: images, empty fields, BAT imports, primary images
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const VEHICLE_ID = process.argv[2];

if (!VEHICLE_ID) {
  console.error('❌ Vehicle ID required');
  console.log('Usage: node scripts/fix-all-vehicle-issues.js <vehicle_id>');
  process.exit(1);
}

async function runScript(scriptName, description) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`\n🔧 ${description}`);
  console.log(`Running: ${scriptName}\n`);
  
  try {
    const { stdout, stderr } = await execAsync(`node ${scriptName} ${VEHICLE_ID}`, {
      cwd: join(__dirname, '..'),
      maxBuffer: 10 * 1024 * 1024 // 10MB
    });
    
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    return true;
  } catch (error) {
    console.error(`❌ Error running ${scriptName}:`, error.message);
    return false;
  }
}

async function fixAll() {
  console.log(`\n🚀 Running All Vehicle Fix Scripts`);
  console.log(`Vehicle ID: ${VEHICLE_ID}\n`);
  console.log('='.repeat(80));

  const scripts = [
    {
      path: 'scripts/diagnose-vehicle-mismatch.js',
      description: '1️⃣  Diagnosing vehicle issues...'
    },
    {
      path: 'scripts/comprehensive-image-fix.js',
      description: '2️⃣  Fixing image contamination...'
    },
    {
      path: 'scripts/fix-vehicle-bat-images.js',
      description: '3️⃣  Fixing BAT image imports...'
    },
    {
      path: 'scripts/fix-vehicle-primary-image.js',
      description: '4️⃣  Fixing primary image...'
    },
    {
      path: 'scripts/fix-empty-vehicle-fields.js',
      description: '5️⃣  Fixing empty database fields...'
    }
  ];

  const results = [];
  for (const script of scripts) {
    const success = await runScript(script.path, script.description);
    results.push({ script: script.path, success });
    
    // Small delay between scripts
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`\n📊 Summary:\n`);
  
  results.forEach((result, idx) => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} ${scripts[idx].description.replace(/^[^\s]+\s+/, '')}`);
  });

  const successCount = results.filter(r => r.success).length;
  console.log(`\n✅ ${successCount}/${results.length} scripts completed successfully\n`);
}

fixAll().catch(console.error);

