#!/usr/bin/env node
/**
 * Fix work order performer names
 * Auto-detect service provider from linked organizations
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('🔧 Fixing work order performer names\n');
  
  // Find events with your name but should show org
  const { data: events } = await supabase
    .from('vehicle_timeline_events')
    .select('id, title, event_date, vehicle_id, service_provider_name, metadata')
    .eq('vehicle_id', '5a1deb95-4b67-4cc3-9575-23bb5b180693')
    .is('service_provider_name', null);
  
  console.log(`Found ${events?.length || 0} events without service provider\n`);
  
  if (!events || events.length === 0) return;
  
  for (const event of events) {
    // Check if vehicle has org relationships
    const { data: orgs } = await supabase
      .from('organization_vehicles')
      .select('businesses!inner(business_name, business_type)')
      .eq('vehicle_id', event.vehicle_id)
      .in('relationship_type', ['service_provider', 'work_location']);
    
    if (orgs && orgs.length > 0) {
      // Use first service provider
      const org = orgs[0].businesses;
      
      console.log(`  Event: ${event.title || event.event_date}`);
      console.log(`  Updating to: ${org.business_name}`);
      
      const { error } = await supabase
        .from('vehicle_timeline_events')
        .update({
          service_provider_name: org.business_name,
          service_provider_type: org.business_type,
          metadata: {
            ...event.metadata,
            performer_updated: new Date().toISOString(),
            performer_source: 'auto_detected_from_org_link'
          }
        })
        .eq('id', event.id);
      
      if (error) {
        console.error(`    ❌ Error:`, error.message);
      } else {
        console.log(`    ✅ Updated\n`);
      }
    }
  }
  
  console.log('✅ DONE!\n');
  console.log('Work orders will now show organization names instead of uploader name.');
}

main().catch(console.error);

