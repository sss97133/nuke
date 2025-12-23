/**
 * View 2002AD organization and all associated vehicles
 * Usage: node scripts/view-2002ad-org.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const ORGANIZATION_ID = '1970291b-081c-4550-94e1-633d194a2a99';

async function viewOrganization() {
  console.log('🏢 2002AD Organization Profile\n');
  console.log('=' .repeat(60));
  
  // Get organization
  const { data: org, error: orgError } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', ORGANIZATION_ID)
    .single();
  
  if (orgError || !org) {
    console.error('❌ Organization not found:', orgError);
    return;
  }
  
  console.log(`\n📋 Organization: ${org.business_name}`);
  console.log(`   Website: ${org.website}`);
  console.log(`   Type: ${org.business_type}`);
  if (org.description) {
    console.log(`   Description: ${org.description.substring(0, 200)}...`);
  }
  
  // Get extraction stats
  if (org.metadata) {
    console.log(`\n📊 Extraction Stats:`);
    console.log(`   Vehicles found: ${org.metadata.vehicles_found || 0}`);
    console.log(`   Vehicles created: ${org.metadata.vehicles_created || 0}`);
    console.log(`   Images found: ${org.metadata.gallery_images_found || 0}`);
    console.log(`   Brochures found: ${org.metadata.brochures_found || 0}`);
    console.log(`   Pages discovered: ${org.metadata.pages_discovered || 0}`);
    console.log(`   Last scrape: ${org.metadata.comprehensive_scrape_at || 'Never'}`);
  }
  
  // Get external identities
  const { data: identities } = await supabase
    .from('external_identities')
    .select('platform, handle, profile_url')
    .eq('metadata->>organization_id', ORGANIZATION_ID);
  
  if (identities && identities.length > 0) {
    console.log(`\n🔗 External Platforms:`);
    identities.forEach(id => {
      console.log(`   ${id.platform}: ${id.handle} - ${id.profile_url}`);
    });
  }
  
  // Get vehicle summary
  const { data: vehicleStats } = await supabase
    .from('organization_vehicles')
    .select(`
      relationship_type,
      status,
      vehicles!inner (
        id,
        year,
        make,
        model,
        primary_image_url
      )
    `)
    .eq('organization_id', ORGANIZATION_ID)
    .limit(1000);
  
  if (vehicleStats) {
    console.log(`\n🚗 Vehicles (${vehicleStats.length} total):`);
    console.log('=' .repeat(60));
    
    // Group by relationship type
    const byType = {};
    vehicleStats.forEach(ov => {
      const type = ov.relationship_type;
      if (!byType[type]) byType[type] = [];
      byType[type].push(ov.vehicles);
    });
    
    Object.entries(byType).forEach(([type, vehicles]) => {
      console.log(`\n${type.toUpperCase()} (${vehicles.length} vehicles):`);
      vehicles
        .filter(v => v.model && v.model.length > 2 && !['AD', 'brakes', 'classic', 'in'].includes(v.model))
        .sort((a, b) => (b.year || 0) - (a.year || 0))
        .slice(0, 20)
        .forEach(v => {
          const img = v.primary_image_url ? '🖼️' : '  ';
          console.log(`   ${img} ${v.year || '?'} ${v.make || ''} ${v.model || ''} ${v.vin ? `(VIN: ${v.vin.substring(0, 8)}...)` : ''}`);
        });
      if (vehicles.length > 20) {
        console.log(`   ... and ${vehicles.length - 20} more`);
      }
    });
  }
  
  // Get images summary
  const { data: imageStats } = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .in('vehicle_id', 
      vehicleStats?.map(ov => ov.vehicles?.id).filter(Boolean) || []
    );
  
  const vehiclesWithImages = new Set(imageStats?.map(img => img.vehicle_id) || []);
  console.log(`\n📸 Images: ${imageStats?.length || 0} total, ${vehiclesWithImages.size} vehicles with images`);
  
  // Get timeline events
  const { data: timelineStats } = await supabase
    .from('timeline_events')
    .select('event_type')
    .in('vehicle_id', 
      vehicleStats?.map(ov => ov.vehicles?.id).filter(Boolean) || []
    );
  
  if (timelineStats) {
    const byEventType = {};
    timelineStats.forEach(te => {
      byEventType[te.event_type] = (byEventType[te.event_type] || 0) + 1;
    });
    console.log(`\n📅 Timeline Events: ${timelineStats.length} total`);
    Object.entries(byEventType).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
  }
  
  console.log('\n' + '='.repeat(60));
}

viewOrganization().catch(console.error);

