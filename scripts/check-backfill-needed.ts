import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkBackfill() {
  console.log('=== CHECKING IF BACKFILL NEEDED ===\n');

  // 1. Comments with auction_event_id but NULL vehicle_id
  const { count: needsBackfill } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .not('auction_event_id', 'is', null)
    .is('vehicle_id', null);

  console.log(`Comments needing vehicle_id backfill: ${needsBackfill?.toLocaleString()}`);

  // 2. Get sample of these
  const { data: sample } = await supabase
    .from('auction_comments')
    .select('id, auction_event_id')
    .not('auction_event_id', 'is', null)
    .is('vehicle_id', null)
    .limit(5);

  if (sample && sample.length > 0) {
    console.log('\nSample comments needing backfill:');
    for (const c of sample) {
      // Get vehicle_id from auction_event
      const { data: event } = await supabase
        .from('auction_events')
        .select('vehicle_id, auction_url')
        .eq('id', c.auction_event_id)
        .single();

      console.log(`  Comment ${c.id} -> Event ${c.auction_event_id} -> Vehicle ${event?.vehicle_id}`);
    }
  }

  // 3. Count comments that already have vehicle_id
  const { count: alreadyLinked } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true })
    .not('vehicle_id', 'is', null);

  console.log(`\nComments already with vehicle_id: ${alreadyLinked?.toLocaleString()}`);

  // 4. Total
  const total = (needsBackfill || 0) + (alreadyLinked || 0);
  console.log(`Total linkable: ${total.toLocaleString()}`);

  // 5. If backfill needed, do it
  if ((needsBackfill || 0) > 0) {
    console.log('\n=== RUNNING BACKFILL ===');
    console.log('This will update comments to have vehicle_id from their auction_event...');

    // Get all comments needing backfill in batches
    let updated = 0;
    let offset = 0;
    const batchSize = 1000;

    while (true) {
      const { data: batch } = await supabase
        .from('auction_comments')
        .select('id, auction_event_id')
        .not('auction_event_id', 'is', null)
        .is('vehicle_id', null)
        .range(offset, offset + batchSize - 1);

      if (!batch || batch.length === 0) break;

      // Get vehicle_ids for these events
      const eventIds = [...new Set(batch.map(c => c.auction_event_id))];
      const { data: events } = await supabase
        .from('auction_events')
        .select('id, vehicle_id')
        .in('id', eventIds);

      const eventToVehicle = new Map(events?.map(e => [e.id, e.vehicle_id]) || []);

      // Update in smaller batches
      for (const comment of batch) {
        const vehicleId = eventToVehicle.get(comment.auction_event_id);
        if (vehicleId) {
          await supabase
            .from('auction_comments')
            .update({ vehicle_id: vehicleId })
            .eq('id', comment.id);
          updated++;
        }
      }

      process.stdout.write(`\rUpdated ${updated.toLocaleString()} comments...`);
      offset += batchSize;
    }

    console.log(`\n\nBackfill complete! Updated ${updated.toLocaleString()} comments.`);
  }
}

checkBackfill().catch(console.error);
