/**
 * Check C&B HTML snapshots to audit extraction quality
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Check for C&B snapshots
  const { data, error } = await supabase
    .from('listing_page_snapshots')
    .select('id, listing_url, created_at, content_length, success')
    .eq('platform', 'carsandbids')
    .eq('success', true)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log('Recent C&B snapshots:');
  data?.forEach(s => {
    console.log(`  ${s.created_at} | ${s.content_length} chars | ${s.listing_url}`);
  });

  if (data && data.length > 0) {
    // Get full HTML of most recent
    const { data: full } = await supabase
      .from('listing_page_snapshots')
      .select('html')
      .eq('id', data[0].id)
      .single();

    if (full?.html) {
      console.log('\n--- ANALYZING MOST RECENT SNAPSHOT ---');
      console.log('URL:', data[0].listing_url);
      console.log('Length:', full.html.length);

      // Check for key sections
      const checks = [
        { name: '__NEXT_DATA__', pattern: /__NEXT_DATA__/ },
        { name: "Doug's Take", pattern: /Doug.?s Take/i },
        { name: 'Highlights', pattern: /Highlights/i },
        { name: 'Equipment', pattern: /Equipment/i },
        { name: 'Known Flaws', pattern: /Known Flaws/i },
        { name: 'Service History', pattern: /Service History/i },
        { name: 'quick-facts', pattern: /quick-facts/i },
        { name: 'media.carsandbids', pattern: /media\.carsandbids\.com/i },
        { name: 'Comments thread', pattern: /class="comment"|ul.*thread/i },
        { name: 'Seller Notes', pattern: /Seller Notes/i },
        { name: 'Modifications', pattern: /Modifications/i },
        { name: 'Carfax', pattern: /carfax/i },
      ];

      console.log('\nContent sections present in HTML:');
      checks.forEach(c => {
        const found = c.pattern.test(full.html);
        console.log(`  ${found ? '✅' : '❌'} ${c.name}`);
      });

      // Count images
      const imgMatches = full.html.match(/media\.carsandbids\.com[^"'\s]*/g) || [];
      const uniqueImgs = [...new Set(imgMatches)];
      const photoUrls = uniqueImgs.filter(u => u.includes('/photos/') && !u.includes('width=80'));
      console.log(`\nImage URLs in HTML: ${uniqueImgs.length} total, ${photoUrls.length} photos`);

      // Now check what we actually stored for this vehicle
      const urlMatch = data[0].listing_url.match(/carsandbids\.com\/auctions\/([^/]+)/);
      if (urlMatch) {
        console.log('\n--- CHECKING WHAT WE STORED IN DATABASE ---');

        // Find vehicle
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('id, year, make, model, vin, mileage, description, exterior_color, interior_color, engine, transmission')
          .or(`discovery_url.ilike.%${urlMatch[1]}%,listing_url.ilike.%${urlMatch[1]}%`)
          .limit(1)
          .maybeSingle();

        if (vehicle) {
          console.log('\nVehicle record:');
          console.log(`  ID: ${vehicle.id}`);
          console.log(`  Year/Make/Model: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
          console.log(`  VIN: ${vehicle.vin || 'MISSING'}`);
          console.log(`  Mileage: ${vehicle.mileage || 'MISSING'}`);
          console.log(`  Exterior Color: ${vehicle.exterior_color || 'MISSING'}`);
          console.log(`  Interior Color: ${vehicle.interior_color || 'MISSING'}`);
          console.log(`  Engine: ${vehicle.engine || 'MISSING'}`);
          console.log(`  Transmission: ${vehicle.transmission || 'MISSING'}`);
          console.log(`  Description: ${vehicle.description ? vehicle.description.substring(0, 100) + '...' : 'MISSING'}`);

          // Check images
          const { data: images } = await supabase
            .from('vehicle_images')
            .select('id')
            .eq('vehicle_id', vehicle.id);
          console.log(`  Images stored: ${images?.length || 0}`);

          // Check external_listings
          const { data: listing } = await supabase
            .from('external_listings')
            .select('id, current_bid, metadata')
            .eq('vehicle_id', vehicle.id)
            .eq('platform', 'carsandbids')
            .maybeSingle();

          if (listing) {
            console.log('\nExternal listing:');
            console.log(`  Current bid: ${listing.current_bid || 'MISSING'}`);
            const meta = listing.metadata as any || {};
            console.log(`  Metadata keys: ${Object.keys(meta).join(', ') || 'NONE'}`);
            if (meta.highlights) console.log(`  ✅ Has highlights`);
            if (meta.equipment) console.log(`  ✅ Has equipment`);
            if (meta.known_flaws) console.log(`  ✅ Has known_flaws`);
            if (meta.dougs_take) console.log(`  ✅ Has dougs_take`);
          } else {
            console.log('\n❌ No external_listing record found');
          }

          // Check comments
          const { data: comments } = await supabase
            .from('auction_comments')
            .select('id')
            .eq('vehicle_id', vehicle.id);
          console.log(`\nComments stored: ${comments?.length || 0}`);

        } else {
          console.log('❌ No vehicle found for this URL');
        }
      }
    }
  } else {
    console.log('No C&B snapshots found');
  }
}

main();
