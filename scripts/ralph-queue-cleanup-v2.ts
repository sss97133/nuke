/**
 * Queue cleanup v2 - Handle remaining failed items
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('=== RALPH QUEUE CLEANUP V2 ===\n');

  // 1. Skip 403 errors (site blocks scraping)
  const { count: blocked403 } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%403%');

  if (blocked403 && blocked403 > 0) {
    await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Site blocks scraping (403)' })
      .eq('status', 'failed')
      .ilike('error_message', '%403%');
    console.log(`✅ Skipped ${blocked403} items with 403 errors`);
  }

  // 2. Skip 401 errors
  const { count: blocked401 } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%401%');

  if (blocked401 && blocked401 > 0) {
    await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Unauthorized (401)' })
      .eq('status', 'failed')
      .ilike('error_message', '%401%');
    console.log(`✅ Skipped ${blocked401} items with 401 errors`);
  }

  // 3. Skip invalid URLs
  const { count: invalidUrls } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%Invalid listing_url%');

  if (invalidUrls && invalidUrls > 0) {
    await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Invalid URL format' })
      .eq('status', 'failed')
      .ilike('error_message', '%Invalid listing_url%');
    console.log(`✅ Skipped ${invalidUrls} items with invalid URLs`);
  }

  // 4. Skip connection errors (dead sites)
  const { count: connErrors } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%error sending request%');

  if (connErrors && connErrors > 0) {
    await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Connection error - site unreachable' })
      .eq('status', 'failed')
      .ilike('error_message', '%error sending request%');
    console.log(`✅ Skipped ${connErrors} items with connection errors`);
  }

  // 5. Skip missing make/model (invalid listings)
  const { count: missingMakeModel } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%Missing make/model%');

  if (missingMakeModel && missingMakeModel > 0) {
    await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Non-vehicle page (no make/model)' })
      .eq('status', 'failed')
      .ilike('error_message', '%Missing make/model%');
    console.log(`✅ Skipped ${missingMakeModel} items missing make/model`);
  }

  // 6. Skip invalid model errors
  const { count: invalidModel } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%Invalid model%');

  if (invalidModel && invalidModel > 0) {
    await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Invalid model data' })
      .eq('status', 'failed')
      .ilike('error_message', '%Invalid model%');
    console.log(`✅ Skipped ${invalidModel} items with invalid model`);
  }

  // 7. Skip 500 errors
  const { count: server500 } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%500%');

  if (server500 && server500 > 0) {
    await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Server error (500)' })
      .eq('status', 'failed')
      .ilike('error_message', '%500%');
    console.log(`✅ Skipped ${server500} items with 500 errors`);
  }

  // 8. Skip timeout errors
  const { count: timeouts } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%timeout%');

  if (timeouts && timeouts > 0) {
    await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Request timeout' })
      .eq('status', 'failed')
      .ilike('error_message', '%timeout%');
    console.log(`✅ Skipped ${timeouts} items with timeouts`);
  }

  // 9. Skip VIN null errors (reset to pending to retry with better extraction)
  const { count: vinErrors } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%null value in column "vin"%');

  if (vinErrors && vinErrors > 0) {
    // These might be retryable - mark as pending with 0 attempts
    await supabase
      .from('import_queue')
      .update({ status: 'pending', attempts: 0, error_message: null })
      .eq('status', 'failed')
      .ilike('error_message', '%null value in column "vin"%');
    console.log(`✅ Reset ${vinErrors} VIN errors for retry`);
  }

  // Final status
  console.log('\n=== FINAL QUEUE STATUS ===');
  const statuses = ['pending', 'processing', 'completed', 'failed', 'skipped'];
  for (const status of statuses) {
    const { count } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', status);
    console.log(`   ${status}: ${(count || 0).toLocaleString()}`);
  }

  // Show remaining failed
  const { data: remainingFailed } = await supabase
    .from('import_queue')
    .select('error_message')
    .eq('status', 'failed')
    .limit(100);

  if (remainingFailed && remainingFailed.length > 0) {
    console.log('\n📋 REMAINING FAILED:');
    const errors: Record<string, number> = {};
    for (const item of remainingFailed) {
      const err = (item.error_message || 'Unknown').substring(0, 50);
      errors[err] = (errors[err] || 0) + 1;
    }
    Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([e, c]) => {
      console.log(`   ${c}: ${e}`);
    });
  }
}

main().catch(console.error);
