#!/usr/bin/env node
/**
 * Run Tier 2 detailed analysis on a vehicle's images
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const vehicleId = 'a76c1d50-eca3-4430-9422-a00ea88725fd';

async function runTier2Analysis() {
  console.log('🔬 Running Tier 2 Analysis on 1983 Chevy K10\\n');
  
  // Get all images for this vehicle
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url')
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: true })
    .limit(3);
  
  if (error || !images?.length) {
    console.error('No images found');
    return;
  }
  
  console.log(`Found ${images.length} images to analyze\\n`);
  
  for (const image of images) {
    console.log('Analyzing:', image.id.substring(0, 8) + '...');
    console.log('URL:', image.image_url.substring(0, 80) + '...');
    
    try {
      const { data, error: analysisError } = await supabase.functions.invoke('analyze-image-tier2', {
        body: {
          image_url: image.image_url,
          vehicle_id: vehicleId,
          image_id: image.id,
          context: {
            year: 1983,
            make: 'chevrolet',
            model: 'K10 Pickup',
            verify_year_from_grille: true
          }
        }
      });
      
      if (analysisError) {
        console.log('❌ Error:', analysisError.message);
      } else {
        console.log('✅ Analysis complete:');
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (e) {
      console.log('❌ Failed:', e.message);
    }
    
    console.log('\\n---\\n');
    await new Promise(r => setTimeout(r, 1000));
  }
}

runTier2Analysis().catch(console.error);
