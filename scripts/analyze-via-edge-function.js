import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const VEHICLE_ID = '1fe31397-4f41-490f-87a2-b8dc44cb7c09';

async function analyzeViaEdgeFunction() {
  console.log('🚨 Using Edge Function for analysis (has proper API keys)\n');

  // Get all images
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .order('created_at', { ascending: true });

  if (!images || images.length === 0) {
    console.log('❌ No images found');
    return;
  }

  const needsAnalysis = images.filter(img => !img.ai_scan_metadata?.appraiser?.primary_label);
  console.log(`📊 Total: ${images.length}, Need analysis: ${needsAnalysis.length}\n`);

  if (needsAnalysis.length === 0) {
    console.log('✅ All images already analyzed!');
    return;
  }

  let analyzed = 0;
  let failed = 0;

  for (let i = 0; i < needsAnalysis.length; i++) {
    const image = needsAnalysis[i];
    
    try {
      console.log(`[${i + 1}/${needsAnalysis.length}] Analyzing via edge function...`);

      // Call analyze-image edge function with proper auth
      const { data, error } = await supabase.functions.invoke('analyze-image', {
        body: {
          image_url: image.image_url,
          vehicle_id: VEHICLE_ID,
          image_id: image.id
        },
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`
        }
      });

      if (error) {
        console.log(`  ❌ Error: ${error.message}`);
        failed++;
        continue;
      }

      if (data && data.success) {
        // Check if analysis was stored
        const { data: updated } = await supabase
          .from('vehicle_images')
          .select('ai_scan_metadata')
          .eq('id', image.id)
          .single();

        if (updated?.ai_scan_metadata?.appraiser?.primary_label) {
          console.log(`  ✅ Analyzed successfully`);
          analyzed++;
        } else {
          console.log(`  ⚠️  Analysis completed but not stored properly`);
          failed++;
        }
      } else {
        console.log(`  ❌ Analysis failed: ${data?.error || 'Unknown error'}`);
        failed++;
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Complete: ${analyzed} analyzed, ${failed} failed\n`);
  
  // Final verification
  const { data: final } = await supabase
    .from('vehicle_images')
    .select('id, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID);

  const stillMissing = final?.filter(img => !img.ai_scan_metadata?.appraiser?.primary_label).length || 0;
  
  if (stillMissing > 0) {
    console.log(`⚠️  WARNING: ${stillMissing} images still missing analysis`);
  } else {
    console.log(`✅ VERIFIED: ALL images have analysis!`);
  }
}

analyzeViaEdgeFunction().catch(console.error);

