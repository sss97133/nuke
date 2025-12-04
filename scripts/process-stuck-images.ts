#!/usr/bin/env tsx
/**
 * Process Stuck AI Analysis Jobs
 * 
 * Finds images stuck on "pending" and processes them
 * 
 * Usage:
 *   npm run process-stuck     # Process stuck images
 *   npm run process-failed    # Retry failed images
 */

import { AIProcessingAuditor } from '../nuke_frontend/src/services/aiProcessingAuditor';

async function main() {
  const command = process.argv[2] || 'stuck';
  
  console.log('🤖 AI Processing Auditor\n');
  
  // Get current status
  const status = await AIProcessingAuditor.getStatus();
  
  console.log('Current Status:');
  console.log(`  Pending: ${status.total_pending}`);
  console.log(`  Stuck (>24h): ${status.total_stuck}`);
  console.log(`  Failed: ${status.total_failed}`);
  if (status.oldest_pending) {
    console.log(`  Oldest pending: ${new Date(status.oldest_pending).toLocaleString()}`);
  }
  console.log('');
  
  if (command === 'failed') {
    // Retry failed images
    console.log('🔄 Retrying failed images...\n');
    const result = await AIProcessingAuditor.retryFailedImages(50);
    
    console.log('\nResults:');
    console.log(`  Retried: ${result.retried}`);
    console.log(`  Succeeded: ${result.succeeded}`);
    console.log(`  Failed again: ${result.failed}`);
    
  } else {
    // Process stuck images
    console.log('🔍 Processing stuck images...\n');
    const result = await AIProcessingAuditor.processStuckImages(100);
    
    console.log('\nResults:');
    console.log(`  Processed: ${result.processed}`);
    console.log(`  Succeeded: ${result.succeeded}`);
    console.log(`  Failed: ${result.failed}`);
  }
  
  // Show updated status
  const newStatus = await AIProcessingAuditor.getStatus();
  console.log('\nUpdated Status:');
  console.log(`  Pending: ${newStatus.total_pending} (was ${status.total_pending})`);
  console.log(`  Failed: ${newStatus.total_failed} (was ${status.total_failed})`);
  
  if (newStatus.total_pending > 0) {
    console.log(`\n⚠️  ${newStatus.total_pending} images still pending. Run again to continue.`);
  } else {
    console.log('\n🎉 All images processed!');
  }
}

main().catch(console.error);

