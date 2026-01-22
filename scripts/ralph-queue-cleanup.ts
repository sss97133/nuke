import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function cleanupQueue() {
  console.log('=== RALPH QUEUE CLEANUP ===\n');

  // Check what's in failed
  console.log('📋 FAILED QUEUE ANALYSIS:');
  const { data: failedItems } = await supabase
    .from('import_queue')
    .select('error_message, listing_url')
    .eq('status', 'failed')
    .limit(500);

  const errorCounts: Record<string, number> = {};
  const urlPatterns: Record<string, number> = {};

  for (const item of failedItems || []) {
    // Count by error type
    const error = item.error_message?.substring(0, 60) || 'Unknown';
    errorCounts[error] = (errorCounts[error] || 0) + 1;

    // Count by URL pattern
    const url = item.listing_url || '';
    if (url.includes('ksl.com')) urlPatterns['ksl.com'] = (urlPatterns['ksl.com'] || 0) + 1;
    else if (url.includes('craigslist')) urlPatterns['craigslist'] = (urlPatterns['craigslist'] || 0) + 1;
    else if (url.includes('carsandbids')) urlPatterns['carsandbids'] = (urlPatterns['carsandbids'] || 0) + 1;
    else if (url.includes('bringatrailer')) urlPatterns['bringatrailer'] = (urlPatterns['bringatrailer'] || 0) + 1;
    else urlPatterns['other'] = (urlPatterns['other'] || 0) + 1;
  }

  console.log('\nBy error type:');
  Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([err, cnt]) => {
    console.log(`   ${cnt}: ${err}`);
  });

  console.log('\nBy URL pattern:');
  Object.entries(urlPatterns).sort((a, b) => b[1] - a[1]).forEach(([pattern, cnt]) => {
    console.log(`   ${pattern}: ${cnt}`);
  });

  // Now apply cleanup
  console.log('\n\n=== APPLYING CLEANUPS ===\n');

  // 1. Skip KSL (always blocked)
  const { count: kslCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .ilike('listing_url', '%ksl.com%')
    .in('status', ['failed', 'pending']);

  if (kslCount && kslCount > 0) {
    const { error: kslError } = await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'KSL blocks scrapers - permanent skip' })
      .ilike('listing_url', '%ksl.com%')
      .in('status', ['failed', 'pending']);

    console.log(`✅ Skipped ${kslCount} KSL items${kslError ? ' (error: ' + kslError.message + ')' : ''}`);
  }

  // 2. Skip 404/410 errors
  const { count: deadLinkCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .or('error_message.ilike.%404%,error_message.ilike.%410%');

  if (deadLinkCount && deadLinkCount > 0) {
    const { error: deadError } = await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Dead link - 404/410' })
      .eq('status', 'failed')
      .or('error_message.ilike.%404%,error_message.ilike.%410%');

    console.log(`✅ Skipped ${deadLinkCount} dead links${deadError ? ' (error: ' + deadError.message + ')' : ''}`);
  }

  // 3. Skip non-vehicle content
  const { count: nonVehicleCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .or('error_message.ilike.%Junk identity%,error_message.ilike.%Non-listing URL%,error_message.ilike.%Invalid make:%');

  if (nonVehicleCount && nonVehicleCount > 0) {
    const { error: nvError } = await supabase
      .from('import_queue')
      .update({ status: 'skipped', error_message: 'Non-vehicle content' })
      .eq('status', 'failed')
      .or('error_message.ilike.%Junk identity%,error_message.ilike.%Non-listing URL%,error_message.ilike.%Invalid make:%');

    console.log(`✅ Skipped ${nonVehicleCount} non-vehicle items${nvError ? ' (error: ' + nvError.message + ')' : ''}`);
  }

  // 4. Release orphaned locks (items stuck in processing > 15 min)
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { count: orphanedCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing')
    .lt('locked_at', fifteenMinAgo);

  if (orphanedCount && orphanedCount > 0) {
    const { error: orphanError } = await supabase
      .from('import_queue')
      .update({ status: 'pending', locked_at: null, locked_by: null })
      .eq('status', 'processing')
      .lt('locked_at', fifteenMinAgo);

    console.log(`✅ Released ${orphanedCount} orphaned locks${orphanError ? ' (error: ' + orphanError.message + ')' : ''}`);
  }

  // 5. Retry vehicle_images table errors (table now exists)
  const { count: tableErrorCount } = await supabase
    .from('import_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'failed')
    .ilike('error_message', '%vehicle_images%does not exist%');

  if (tableErrorCount && tableErrorCount > 0) {
    const { error: tableError } = await supabase
      .from('import_queue')
      .update({ status: 'pending', attempts: 0, error_message: null })
      .eq('status', 'failed')
      .ilike('error_message', '%vehicle_images%does not exist%');

    console.log(`✅ Reset ${tableErrorCount} old table errors for retry${tableError ? ' (error: ' + tableError.message + ')' : ''}`);
  }

  // Final status
  console.log('\n\n=== FINAL QUEUE STATUS ===');
  const statuses = ['pending', 'processing', 'completed', 'failed', 'skipped'];
  for (const status of statuses) {
    const { count } = await supabase.from('import_queue').select('*', { count: 'exact', head: true }).eq('status', status);
    console.log(`   ${status}: ${(count || 0).toLocaleString()}`);
  }
}

cleanupQueue().catch(console.error);
