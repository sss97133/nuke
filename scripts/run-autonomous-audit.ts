#!/usr/bin/env tsx
/**
 * CLI Runner for Autonomous Data Auditor
 * 
 * Usage:
 *   npm run audit              # Run with default config
 *   npm run audit -- --budget=100  # Custom daily budget
 *   npm run audit -- --vehicles=10 # Audit 10 vehicles
 *   npm run audit -- --dry-run     # Show what would happen
 */

import { AutonomousDataAuditor } from '../nuke_frontend/src/services/autonomousDataAuditor';

interface CLIOptions {
  budget?: number;
  vehicles?: number;
  confidence?: number;
  dryRun?: boolean;
  enableVin?: boolean;
  enableScrape?: boolean;
  enableOcr?: boolean;
  enableAi?: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};
  
  args.forEach(arg => {
    if (arg.startsWith('--budget=')) {
      options.budget = parseFloat(arg.split('=')[1]);
    } else if (arg.startsWith('--vehicles=')) {
      options.vehicles = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--confidence=')) {
      options.confidence = parseInt(arg.split('=')[1]);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--enable-vin') {
      options.enableVin = true;
    } else if (arg === '--enable-scrape') {
      options.enableScrape = true;
    } else if (arg === '--enable-ocr') {
      options.enableOcr = true;
    } else if (arg === '--enable-ai') {
      options.enableAi = true;
    }
  });
  
  return options;
}

async function main() {
  console.log('🤖 Autonomous Data Auditor\n');
  
  const options = parseArgs();
  
  // Build config from CLI args
  const config: any = {};
  
  if (options.budget) {
    config.daily_cost_limit = options.budget;
  }
  if (options.vehicles) {
    config.max_vehicles_per_run = options.vehicles;
  }
  if (options.confidence) {
    config.min_confidence_auto_fix = options.confidence;
  }
  if (options.enableVin !== undefined) {
    config.enable_vin_decode = options.enableVin;
  }
  if (options.enableScrape !== undefined) {
    config.enable_listing_scrape = options.enableScrape;
  }
  if (options.enableOcr !== undefined) {
    config.enable_image_ocr = options.enableOcr;
  }
  if (options.enableAi !== undefined) {
    config.enable_ai_analysis = options.enableAi;
  }
  
  // Show config
  console.log('Configuration:');
  console.log('  Daily budget: $' + (config.daily_cost_limit || 50));
  console.log('  Max vehicles: ' + (config.max_vehicles_per_run || 50));
  console.log('  Auto-fix confidence: ' + (config.min_confidence_auto_fix || 85) + '%');
  console.log('  VIN decode: ' + (config.enable_vin_decode !== false ? 'enabled' : 'disabled'));
  console.log('  Listing scrape: ' + (config.enable_listing_scrape !== false ? 'enabled' : 'disabled'));
  console.log('  Image OCR: ' + (config.enable_image_ocr ? 'enabled' : 'disabled'));
  console.log('  AI analysis: ' + (config.enable_ai_analysis !== false ? 'enabled' : 'disabled'));
  console.log('  Dry run: ' + (options.dryRun ? 'YES (no changes will be made)' : 'NO'));
  console.log('');
  
  if (options.dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made to the database\n');
    // In dry run, set budget to 0 to prevent execution
    config.daily_cost_limit = 0;
  }
  
  // Create auditor
  const auditor = new AutonomousDataAuditor(config);
  
  // Run audit
  const startTime = Date.now();
  const summary = await auditor.runAudit();
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Run ID: ${summary.run_id}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Status: ${summary.status}`);
  console.log('');
  console.log(`Vehicles audited: ${summary.vehicles_audited}`);
  console.log(`Vehicles improved: ${summary.vehicles_improved}`);
  console.log(`Vehicles flagged: ${summary.vehicles_flagged}`);
  console.log('');
  console.log(`Total cost: $${summary.total_cost.toFixed(2)}`);
  console.log(`Total fixes applied: ${summary.total_fixes}`);
  console.log('');
  
  // Show top issues found
  const allMissingFields = summary.results.flatMap(r => r.missing_fields);
  const missingFieldCounts = allMissingFields.reduce((acc, field) => {
    acc[field] = (acc[field] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  if (Object.keys(missingFieldCounts).length > 0) {
    console.log('Most common missing fields:');
    Object.entries(missingFieldCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([field, count]) => {
        console.log(`  ${field}: ${count} vehicles`);
      });
    console.log('');
  }
  
  // Show vehicles needing approval
  const needingApproval = summary.results.filter(r => r.actions_pending_approval.length > 0);
  if (needingApproval.length > 0) {
    console.log(`⏸️  ${needingApproval.length} vehicles need human approval`);
    console.log('');
  }
  
  // Show individual results in verbose mode
  if (process.env.VERBOSE === 'true') {
    console.log('DETAILED RESULTS:');
    console.log('='.repeat(60));
    summary.results.forEach(r => {
      console.log(`\n${r.vehicle_display} (${r.vehicle_id})`);
      console.log(`  Overall score: ${r.overall_score}/100`);
      console.log(`  Missing fields: ${r.missing_fields.join(', ') || 'none'}`);
      console.log(`  Validation errors: ${r.validation_errors.length}`);
      console.log(`  Actions executed: ${r.actions_executed.length}`);
      console.log(`  Cost: $${r.cost_spent.toFixed(2)}`);
    });
  }
  
  console.log('='.repeat(60));
  console.log('✅ Audit complete!');
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Audit failed:', error);
  process.exit(1);
});

