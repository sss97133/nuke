import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkSchema() {
  console.log('Checking database schema for structured data tables...\n');

  // Check for existing junction tables
  const tables = [
    'vehicle_equipment',
    'vehicle_flaws',
    'vehicle_modifications',
    'vehicle_features',
    'vehicle_specs'
  ];

  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('id').limit(1);
      if (error && error.code === '42P01') {
        console.log(`${table}: NOT EXISTS`);
      } else if (error) {
        console.log(`${table}: ERROR - ${error.message}`);
      } else {
        console.log(`${table}: EXISTS`);
      }
    } catch (e: any) {
      console.log(`${table}: EXCEPTION - ${e.message}`);
    }
  }

  // Check a sample of recently backfilled data
  console.log('\n--- Sample Backfilled Metadata ---\n');

  const { data: sample } = await supabase
    .from('external_listings')
    .select('id, metadata')
    .eq('platform', 'cars_and_bids')
    .not('metadata->>source', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (sample?.metadata) {
    console.log('Source:', sample.metadata.source);
    console.log('Equipment items:', sample.metadata.equipment?.length || 0);
    console.log('Known Flaws items:', sample.metadata.known_flaws?.length || 0);
    console.log('Modifications items:', sample.metadata.modifications?.length || 0);
    console.log('Service History items:', sample.metadata.service_history?.length || 0);
    console.log('Comment count:', sample.metadata.comment_count);
    console.log('Image count:', sample.metadata.image_count);
    console.log('Auction result:', JSON.stringify(sample.metadata.auction_result));

    if (sample.metadata.equipment?.length > 0) {
      console.log('\nSample equipment:');
      sample.metadata.equipment.slice(0, 3).forEach((e: string) => {
        console.log(`  - ${e.substring(0, 60)}...`);
      });
    }
  }

  // Check auction_comments table
  console.log('\n--- Auction Comments Sample ---\n');

  const { data: comments } = await supabase
    .from('auction_comments')
    .select('*')
    .eq('platform', 'cars_and_bids')
    .order('created_at', { ascending: false })
    .limit(3);

  if (comments && comments.length > 0) {
    console.log(`Found ${comments.length} sample comments`);
    comments.forEach((c: any) => {
      console.log(`  @${c.author_username}: "${c.comment_text?.substring(0, 50)}..." [${c.comment_type}]`);
    });
  }
}

checkSchema().catch(console.error);
