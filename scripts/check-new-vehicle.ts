import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const vehicleId = 'c343aa46-75ad-41e1-af6b-199eedffbaf7'; // 2022 Porsche Macan

  const { data: v } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (!v) { console.log('Vehicle not found'); return; }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  NEWLY BACKFILLED VEHICLE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('BASIC INFO');
  console.log('  Vehicle:', v.year, v.make, v.model);
  console.log('  VIN:', v.vin);
  console.log('  Updated:', v.updated_at);
  console.log('');
  console.log('AUCTION DATA (from vehicles table)');
  console.log('  Description:', v.description?.substring(0, 100) || 'N/A');
  console.log('  Seller:', v.bat_seller || 'N/A');
  console.log('  Sold Price:', v.sold_price || 'N/A');
  console.log('  High Bid:', v.high_bid || 'N/A');
  console.log('  Bid Count:', v.bid_count || 'N/A');
  console.log('  View Count:', v.view_count || 'N/A');
  console.log('  Auction Outcome:', v.auction_outcome || 'N/A');
  console.log('  Location:', v.location || 'N/A');

  // Check content sections
  const { data: sections } = await supabase
    .from('vehicle_content_sections')
    .select('section_type, content')
    .eq('vehicle_id', vehicleId);

  console.log('');
  console.log('CONTENT SECTIONS (' + (sections?.length || 0) + ')');
  sections?.forEach(s => {
    const preview = typeof s.content === 'string'
      ? s.content.substring(0, 55)
      : (Array.isArray(s.content) ? s.content.length + ' items' : JSON.stringify(s.content).substring(0, 55));
    console.log('  -', s.section_type + ':', preview + '...');
  });

  // Check images
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('image_url, category')
    .eq('vehicle_id', vehicleId);

  console.log('');
  console.log('IMAGES (' + (images?.length || 0) + ')');

  // Check unique hashes
  const hashes = new Map<string, number>();
  images?.forEach(img => {
    const m = img.image_url?.match(/\/([a-f0-9]{40})\/photos/);
    if (m) hashes.set(m[1], (hashes.get(m[1]) || 0) + 1);
  });
  console.log('  Unique hashes:', hashes.size);
  hashes.forEach((count, hash) => {
    console.log('    ' + hash.substring(0, 12) + '...:', count);
  });

  // Check comments
  const { data: comments, count: cmtCount } = await supabase
    .from('auction_comments')
    .select('author_username, comment_text, is_seller, posted_at', { count: 'exact' })
    .eq('vehicle_id', vehicleId)
    .order('posted_at', { ascending: true })
    .limit(5);

  console.log('');
  console.log('COMMENTS (' + (cmtCount || 0) + ')');
  comments?.slice(0, 4).forEach((c, i) => {
    const tag = c.is_seller ? ' [SELLER]' : '';
    console.log('  ' + (i+1) + '. ' + c.author_username + tag);
    console.log('     "' + (c.comment_text?.substring(0, 60) || '') + '..."');
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
}

main();
