import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CONFIG = {
  BATCH_SIZE: 25,
  DELAY_BETWEEN_BATCHES: 300,
};

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  MAP AUCTION COMMENTS TO TIMELINE EVENTS');
  console.log('═══════════════════════════════════════════════════════════════');

  // Get count of comments without timeline events
  const { count: totalComments } = await supabase
    .from('auction_comments')
    .select('*', { count: 'exact', head: true });

  console.log(`Total auction comments: ${totalComments}`);

  // Check how many already have timeline events (by content_hash in metadata)
  const { count: existingEvents } = await supabase
    .from('timeline_events')
    .select('*', { count: 'exact', head: true })
    .eq('event_type', 'auction_activity');

  console.log(`Existing auction timeline events: ${existingEvents}`);

  let processed = 0;
  let created = 0;
  let skipped = 0;
  let errors = 0;
  let offset = 0;

  // Get existing content hashes to skip
  console.log('Fetching existing content hashes...');
  const existingHashSet = new Set<string>();
  let hashOffset = 0;
  while (true) {
    const { data: existing } = await supabase
      .from('timeline_events')
      .select('metadata')
      .not('metadata->content_hash', 'is', null)
      .range(hashOffset, hashOffset + 1000);

    if (!existing || existing.length === 0) break;
    existing.forEach(e => {
      const hash = (e.metadata as any)?.content_hash;
      if (hash) existingHashSet.add(hash);
    });
    hashOffset += 1000;
  }
  console.log(`Found ${existingHashSet.size} existing hashes to skip`);

  while (true) {
    // Fetch batch of comments
    const { data: comments, error } = await supabase
      .from('auction_comments')
      .select('*')
      .order('posted_at', { ascending: true })
      .range(offset, offset + CONFIG.BATCH_SIZE - 1);

    if (error) {
      console.error('Error fetching comments:', error);
      break;
    }

    if (!comments || comments.length === 0) {
      break;
    }

    console.log(`\nProcessing batch at offset ${offset} (${comments.length} comments)...`);

    // Prepare timeline events
    const timelineEvents = [];

    for (const comment of comments) {
      processed++;

      // Skip if already exists
      if (comment.content_hash && existingHashSet.has(comment.content_hash)) {
        skipped++;
        continue;
      }

      // Determine event type and title
      const isBid = comment.bid_amount !== null && comment.bid_amount > 0;
      const eventType = 'auction_activity';

      let title: string;
      let description: string;

      if (isBid) {
        title = `${comment.author_username || 'Anonymous'} placed bid: $${comment.bid_amount?.toLocaleString()}`;
        description = comment.comment_text || `Bid of $${comment.bid_amount?.toLocaleString()}`;
      } else {
        const commentType = comment.comment_type || 'comment';
        title = `${comment.author_username || 'Anonymous'}: ${commentType}`;
        description = comment.comment_text || '';
      }

      // Truncate description if too long
      if (description.length > 2000) {
        description = description.substring(0, 1997) + '...';
      }

      // Skip if no posted_at date (required field)
      if (!comment.posted_at) {
        skipped++;
        continue;
      }

      const event = {
        vehicle_id: comment.vehicle_id,
        event_type: isBid ? 'auction_bid_placed' : 'other',
        source: comment.platform || 'auction',
        title: title.substring(0, 255),
        description,
        event_date: new Date(comment.posted_at).toISOString().split('T')[0],
        data_source: 'bat_description',
        source_type: 'service_record',
        confidence_score: 90,
        metadata: {
          content_hash: comment.content_hash,
          auction_comment_id: comment.id,
          author_username: comment.author_username,
          author_type: comment.author_type,
          is_seller: comment.is_seller,
          comment_type: comment.comment_type,
          comment_likes: comment.comment_likes,
          reply_count: comment.reply_count,
          bid_amount: comment.bid_amount,
          is_leading_bid: comment.is_leading_bid,
          sequence_number: comment.sequence_number,
          hours_until_close: comment.hours_until_close,
          platform: comment.platform,
          source_url: comment.source_url,
          posted_at: comment.posted_at,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      timelineEvents.push(event);
    }

    // Insert batch
    if (timelineEvents.length > 0) {
      const { error: insertError } = await supabase
        .from('timeline_events')
        .insert(timelineEvents);

      if (insertError) {
        console.error('  Insert error:', insertError.message);
        errors += timelineEvents.length;
      } else {
        created += timelineEvents.length;
        console.log(`  Created ${timelineEvents.length} timeline events`);
      }
    }

    offset += CONFIG.BATCH_SIZE;

    // Progress update
    if (processed % 1000 === 0) {
      console.log(`  Progress: ${processed} processed, ${created} created, ${skipped} skipped`);
    }

    // Delay between batches
    await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_BATCHES));
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total processed: ${processed}`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (existing): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
