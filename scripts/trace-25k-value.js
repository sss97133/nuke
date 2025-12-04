#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const vehicleId = '5a1deb95-4b67-4cc3-9575-23bb5b180693';

async function main() {
  console.log('🔍 Tracing where $25,000 comes from\n');
  
  // Get vehicle
  const { data: vehicle } = await supabase.from('vehicles').select('*').eq('id', vehicleId).single();
  console.log('Vehicle:', vehicle?.year, vehicle?.make, vehicle?.model);
  console.log('VIN:', vehicle?.vin);
  console.log('');
  
  // Check all price fields
  console.log('Database price fields:');
  console.log('  sale_price:', vehicle?.sale_price || 'NULL');
  console.log('  purchase_price:', vehicle?.purchase_price || 'NULL');
  console.log('  current_value:', vehicle?.current_value || 'NULL');
  console.log('  asking_price:', vehicle?.asking_price || 'NULL');
  console.log('');
  
  // Calculate frontend logic
  const baseValue = 35000 * (1 - 0.8); // GMC depreciated
  const imageCount = await supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).eq('vehicle_id', vehicleId);
  const imageBonus = Math.min(imageCount.count || 0, 50) * 25;
  
  console.log('Frontend calculation (VehiclePricingWidget):');
  console.log('  Base value (1983 GMC):', baseValue);
  console.log('  Image count:', imageCount.count);
  console.log('  Image bonus:', imageBonus);
  console.log('  Total:', baseValue + imageBonus);
  console.log('');
  
  // Check image tags for mods
  const { data: images } = await supabase.from('vehicle_images').select('id').eq('vehicle_id', vehicleId);
  if (images) {
    const { data: tags } = await supabase
      .from('image_tags')
      .select('*')
      .in('image_id', images.map(i => i.id))
      .in('type', ['product', 'part', 'brand']);
    
    console.log('Detected parts/mods:', tags?.length || 0);
    
    // Calculate mod value
    let modValue = 0;
    const brands = new Set();
    (tags || []).forEach(t => {
      if (t.type === 'brand') brands.add(t.text || t.tag_text);
      if (t.type === 'product' || t.type === 'part') modValue += 500; // Rough estimate
    });
    
    console.log('  Unique brands:', brands.size);
    console.log('  Estimated mod value:', modValue);
    console.log('');
    
    console.log('TOTAL ESTIMATED:');
    console.log('  Base + Images + Mods:', (baseValue + imageBonus + modValue).toFixed(0));
  }
}

main();

