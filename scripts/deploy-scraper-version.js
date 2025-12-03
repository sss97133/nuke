#!/usr/bin/env node
/**
 * Deploy Scraper Version
 * Registers a new scraper version and auto-queues affected vehicles for backfill
 * 
 * Usage:
 *   node deploy-scraper-version.js <scraper_name> <version> [--fields vin,mileage] [--priority 1-10]
 * 
 * Examples:
 *   # Register KSL scraper improvement (triggers auto-backfill)
 *   node deploy-scraper-version.js ksl_scraper v3.2.1 --fields vin --priority 1
 *   
 *   # Register without backfill
 *   node deploy-scraper-version.js bat_scraper v2.2.0 --no-backfill
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const scraperName = process.argv[2];
const version = process.argv[3];
const fieldsArg = process.argv.find(arg => arg.startsWith('--fields='));
const priorityArg = process.argv.find(arg => arg.startsWith('--priority='));
const noBackfill = process.argv.includes('--no-backfill');

if (!scraperName || !version) {
  console.error('❌ Usage: node deploy-scraper-version.js <scraper_name> <version> [--fields vin,mileage] [--priority 1-10] [--no-backfill]');
  console.error('\nExamples:');
  console.error('  node deploy-scraper-version.js ksl_scraper v3.2.1 --fields=vin --priority=1');
  console.error('  node deploy-scraper-version.js bat_scraper v2.2.0 --no-backfill');
  process.exit(1);
}

const fields = fieldsArg ? fieldsArg.split('=')[1].split(',') : ['vin', 'mileage', 'transmission'];
const priority = priorityArg ? parseInt(priorityArg.split('=')[1]) : 5;

async function deployVersion() {
  console.log(`\n🚀 Deploying Scraper Version\n`);
  console.log(`  Scraper: ${scraperName}`);
  console.log(`  Version: ${version}`);
  console.log(`  Fields affected: ${fields.join(', ')}`);
  console.log(`  Priority: ${priority}`);
  console.log(`  Backfill: ${noBackfill ? 'NO' : 'YES'}`);
  
  // Register version
  const { data: newVersion, error: versionError } = await supabase
    .from('scraper_versions')
    .insert({
      scraper_name: scraperName,
      version,
      improvements: [`Deployed via script at ${new Date().toISOString()}`],
      fields_affected: fields,
      backfill_required: !noBackfill,
      backfill_priority: priority,
      deployed_at: new Date().toISOString(),
      deployed_by: 'deploy_script',
      release_notes: `Automated deployment of ${scraperName} ${version}`
    })
    .select()
    .single();
  
  if (versionError) {
    console.error('\n❌ Failed to register version:', versionError.message);
    process.exit(1);
  }
  
  console.log(`\n✅ Version registered: ${newVersion.id}`);
  
  if (!noBackfill) {
    // Wait a bit for trigger to process
    console.log('\n⏳ Waiting for auto-queue trigger...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check how many vehicles were queued
    const { count, error: countError } = await supabase
      .from('backfill_queue')
      .select('*', { count: 'exact', head: true })
      .eq('scraper_version_id', newVersion.id);
    
    if (countError) {
      console.error('❌ Failed to count queued vehicles:', countError.message);
    } else {
      console.log(`✅ Auto-queued ${count} vehicles for backfill`);
      
      if (count > 0) {
        console.log(`\n📋 To process the queue, run:`);
        console.log(`   npx supabase functions invoke process-backfill-queue`);
        console.log(`\n   Or set up automatic processing (every 5 min):`);
        console.log(`   See: docs/SELF_HEALING_DATA_SYSTEM.md`);
      }
    }
  }
  
  console.log('\n🎉 Deployment complete!\n');
}

deployVersion().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

