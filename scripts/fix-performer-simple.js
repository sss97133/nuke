#!/usr/bin/env node
/**
 * Simple fix: Just set service_provider_name, skip the type
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('🔧 Setting service provider names (skip type constraint)\n');
  
  const { data: updated, error } = await supabase
    .from('vehicle_timeline_events')
    .update({
      service_provider_name: 'Viva! Las Vegas Autos'
    })
    .eq('vehicle_id', '5a1deb95-4b67-4cc3-9575-23bb5b180693')
    .is('service_provider_name', null)
    .select('id');
  
  if (error) {
    console.error('❌ Error:', error);
  } else {
    console.log(`✅ Updated ${updated?.length || 0} events`);
    console.log('\nWork orders will now show "Viva! Las Vegas Autos" instead of "skylar williams"\n');
  }
}

main().catch(console.error);

