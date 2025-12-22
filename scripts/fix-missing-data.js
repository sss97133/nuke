#!/usr/bin/env node
/**
 * Fix missing images and organization link
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);
const vehicleId = 'e92537b2-4ee6-4a84-9c30-ebe7d2afb4f8';

async function fixMissing() {
  console.log('\n🔧 Fixing missing data...\n');
  
  // Find org
  const { data: org } = await supabase
    .from('businesses')
    .select('id')
    .eq('website', 'https://www.pcarmarket.com')
    .maybeSingle();
  
  const orgId = org?.id || 'f7c80592-6725-448d-9b32-2abf3e011cf8';
  
  // Fix images
  console.log('📸 Adding images...');
  const images = [
    'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/7px6oyvwxubawlvd4cr52yopjrzs2ixg-2025-02-21-ZcnWw5gj/Cover Photo Ratio.jpg',
    'https://d2niwqq19lf86s.cloudfront.net/htwritable/media/uploads/galleries/photos/uploads/galleries/54235-2002-aston-martin-db7-v12-vantage-gta/pics4cars.com-27.jpg'
  ];
  
  // Delete existing first
  await supabase
    .from('vehicle_images')
    .delete()
    .eq('vehicle_id', vehicleId);
  
  const imageInserts = images.map((url, i) => ({
    vehicle_id: vehicleId,
    image_url: url,
    category: 'pcarmarket_listing',
    source: 'pcarmarket_listing',
    is_primary: i === 0,
    filename: `pcarmarket_${i}.jpg`
  }));
  
  const { error: imgError } = await supabase
    .from('vehicle_images')
    .insert(imageInserts);
  
  if (imgError) {
    console.error('❌ Image error:', imgError);
  } else {
    console.log('   ✅ Added', images.length, 'images');
  }
  
  // Fix org link
  console.log('\n🏢 Adding organization link...');
  const { error: orgError } = await supabase
    .from('organization_vehicles')
    .upsert({
      organization_id: orgId,
      vehicle_id: vehicleId,
      relationship_type: 'consigner',
      status: 'active',
      listing_status: 'listed',
      listing_url: 'https://www.pcarmarket.com/auction/2002-aston-martin-db7-v12-vantage-2',
      auto_tagged: true
    }, {
      onConflict: 'organization_id,vehicle_id,relationship_type'
    });
  
  if (orgError) {
    console.error('❌ Org link error:', orgError);
  } else {
    console.log('   ✅ Added organization link');
  }
  
  console.log('\n✅ Fixed!\n');
}

fixMissing();

