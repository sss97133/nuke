/**
 * COMPREHENSIVE AI IMAGE SCANNER
 * Scans ALL images in database (vehicle_images + organization_images)
 * Applies AI product scanner to build complete shoppable catalog
 * 
 * Cost: ~$0.05 per untagged image
 * Value: Creates buy buttons, product database, real estimates
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 COMPREHENSIVE AI IMAGE SCANNER\n');
console.log('Scanning ALL images in database for products...\n');

// Get all vehicle images (check which ones don't have products yet)
const { data: allVehicleImages } = await supabase
  .from('vehicle_images')
  .select('id, image_url, vehicle_id, owner_shop_id');

// Get images that already have products
const { data: imagesWithProducts } = await supabase
  .from('image_tags')
  .select('image_id')
  .eq('is_shoppable', true);

const productImageIds = new Set((imagesWithProducts || []).map(t => t.image_id));

// Filter out images that already have products
const vehicleImages = (allVehicleImages || []).filter(img => !productImageIds.has(img.id)).slice(0, 5000);

// Get all organization images (check which ones don't have products yet)
const { data: allOrgImages } = await supabase
  .from('organization_images')
  .select('id, image_url, organization_id');

// Filter out images that already have products (by image_url since org images use URL as key)
const { data: orgImagesWithProducts } = await supabase
  .from('image_tags')
  .select('image_url')
  .eq('is_shoppable', true);

const productImageUrls = new Set((orgImagesWithProducts || []).map(t => t.image_url));

const orgImages = (allOrgImages || []).filter(img => !productImageUrls.has(img.image_url)).slice(0, 5000);

const allImages = [
  ...vehicleImages.map(img => ({ ...img, type: 'vehicle', organization_id: img.owner_shop_id })),
  ...orgImages.map(img => ({ ...img, type: 'organization' }))
];

console.log(`📸 Found ${allImages.length} images to scan`);
console.log(`   - Vehicle images: ${vehicleImages.length}`);
console.log(`   - Organization images: ${orgImages.length}`);
console.log(`💰 Estimated cost: $${(allImages.length * 0.05).toFixed(2)}\n`);

let totalProducts = 0;
let totalValue = 0;
let totalHours = 0;
let imagesWithProducts = 0;
let errors = 0;
let processed = 0;

for (let i = 0; i < allImages.length; i++) {
  const img = allImages[i];
  const progress = `[${i + 1}/${allImages.length}]`;

  process.stdout.write(`${progress} ${img.type === 'vehicle' ? 'V' : 'O'}... `);

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/analyze-work-photos-with-products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        image_url: img.image_url,
        image_id: img.id,
        organization_id: img.organization_id || img.owner_shop_id
      })
    });

    const result = await response.json();

    if (result.success) {
      const productCount = result.analysis?.products?.length || 0;
      const hours = result.analysis?.estimated_hours || 0;

      if (productCount > 0) {
        imagesWithProducts++;
        totalProducts += productCount;
        totalHours += hours;

        result.analysis.products.forEach(p => {
          totalValue += (p.estimated_price || 0);
        });

        console.log(`✅ ${productCount} products, ${hours}h`);
      } else {
        console.log(`⚪ no products`);
      }

      // Image is now tagged (no need to mark separately - tags table tracks this)

      processed++;
    } else {
      console.log(`❌ ${result.error || 'Unknown error'}`);
      errors++;
    }

    // Rate limit: 1 request per second
    await new Promise(resolve => setTimeout(resolve, 1000));

  } catch (err) {
    console.log(`❌ ${err.message}`);
    errors++;
  }
}

console.log(`\n\n🎯 FINAL RESULTS:`);
console.log(`─────────────────────────────────────`);
console.log(`Total images scanned: ${processed}`);
console.log(`Images with products: ${imagesWithProducts}`);
console.log(`Total products identified: ${totalProducts}`);
console.log(`Total estimated value: $${totalValue.toFixed(2)}`);
console.log(`Total estimated hours: ${totalHours.toFixed(1)}`);
console.log(`Errors: ${errors}`);
console.log(`\n✅ All products now SHOPPABLE in timeline popup!`);

