/**
 * Fix vehicles with broken import_queue primary images
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const functionsUrl = `${supabaseUrl}/functions/v1/extract-premium-auction`;

async function main() {
  // Get broken vehicles
  const { data: broken } = await supabase
    .from('vehicles')
    .select('id, discovery_url')
    .like('discovery_url', '%bringatrailer%')
    .like('primary_image_url', '%import_queue%');
  
  console.log(`Found ${broken?.length || 0} vehicles with broken images`);
  
  let fixed = 0;
  for (const v of (broken || [])) {
    try {
      const res = await fetch(functionsUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: v.discovery_url, force_re_extract: true }),
      });
      
      const data = await res.json();
      if (data.vehicles_updated > 0) {
        // Now update primary_image_url from vehicle_images
        const { data: img } = await supabase
          .from('vehicle_images')
          .select('image_url')
          .eq('vehicle_id', v.id)
          .like('image_url', '%bringatrailer%')
          .limit(1)
          .single();
        
        if (img?.image_url) {
          await supabase
            .from('vehicles')
            .update({ primary_image_url: img.image_url, image_url: img.image_url })
            .eq('id', v.id);
          console.log(`✓ Fixed: ${v.discovery_url.split('/').slice(-2)[0]}`);
          fixed++;
        }
      }
    } catch (e) {
      console.log(`✗ Failed: ${v.discovery_url.split('/').slice(-2)[0]}`);
    }
  }
  
  console.log(`\nFixed ${fixed}/${broken?.length || 0} vehicles`);
}

main();



