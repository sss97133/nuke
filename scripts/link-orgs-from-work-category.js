/**
 * Link organizations to vehicles based on work category in timeline events
 * 
 * This script identifies organizations based on work_category metadata:
 * - Paint work → Taylor Customs
 * - Upholstery/Interior → Ernies Upholstery  
 * - Fabrication/Mechanical → Viva! Las Vegas Autos
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Organization mappings
const ORG_MAP = {
  'taylor_customs': {
    id: '66352790-b70e-4de8-bfb1-006b91fa556f',
    name: 'Taylor Customs',
    categories: ['paint', 'bodywork', 'paint_work']
  },
  'ernies_upholstery': {
    id: 'e796ca48-f3af-41b5-be13-5335bb422b41',
    name: 'Ernies Upholstery',
    categories: ['upholstery', 'interior', 'interior_work']
  },
  'viva': {
    id: 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',
    name: 'Viva! Las Vegas Autos',
    categories: ['fabrication', 'mechanical', 'welding', 'work_location']
  }
};

async function linkOrganizationsFromWorkCategory(vehicleId) {
  console.log(`🔗 Linking organizations for vehicle: ${vehicleId}\n`);

  // Get all timeline events with work_category metadata
  const { data: events, error } = await supabase
    .from('timeline_events')
    .select('id, event_date, title, metadata, vehicle_id')
    .eq('vehicle_id', vehicleId)
    .not('metadata->work_category', 'is', null);

  if (error) {
    console.error('Error fetching events:', error);
    return;
  }

  if (!events || events.length === 0) {
    console.log('No events with work_category found');
    return;
  }

  console.log(`Found ${events.length} events with work_category\n`);

  const linksCreated = new Set();

  for (const event of events) {
    const workCategory = event.metadata?.work_category?.toLowerCase() || '';
    
    // Determine which organization based on work category
    let matchedOrg = null;
    
    for (const [key, org] of Object.entries(ORG_MAP)) {
      if (org.categories.some(cat => workCategory.includes(cat))) {
        matchedOrg = org;
        break;
      }
    }

    if (!matchedOrg) {
      // Default to Viva for general work
      matchedOrg = ORG_MAP.viva;
    }

    const linkKey = `${matchedOrg.id}-${event.vehicle_id}`;
    
    if (linksCreated.has(linkKey)) {
      continue; // Already linked
    }

    // Determine relationship type
    let relationshipType = 'service_provider';
    if (matchedOrg.id === ORG_MAP.taylor_customs.id) {
      relationshipType = 'painter';
    } else if (matchedOrg.id === ORG_MAP.ernies_upholstery.id) {
      relationshipType = 'upholstery';
    } else if (matchedOrg.id === ORG_MAP.viva.id) {
      relationshipType = 'work_location';
    }

    // Check if link already exists
    const { data: existing } = await supabase
      .from('organization_vehicles')
      .select('id')
      .eq('organization_id', matchedOrg.id)
      .eq('vehicle_id', event.vehicle_id)
      .eq('relationship_type', relationshipType)
      .maybeSingle();

    if (existing) {
      console.log(`  ⏭  Already linked to ${matchedOrg.name} (${relationshipType})`);
      continue;
    }

    // Create organization_vehicles link
    const { error: linkError } = await supabase
      .from('organization_vehicles')
      .insert({
        organization_id: matchedOrg.id,
        vehicle_id: event.vehicle_id,
        relationship_type: relationshipType,
        status: 'active',
        auto_tagged: true,
        start_date: event.event_date,
        notes: `Auto-linked from work_category: ${workCategory}`
      });

    if (linkError) {
      console.error(`  ❌ Error linking to ${matchedOrg.name}:`, linkError.message);
    } else {
      console.log(`  ✅ Linked to ${matchedOrg.name} (${relationshipType}) from work_category: ${workCategory}`);
      linksCreated.add(linkKey);
    }

    // Also update the timeline event with organization_id
    if (!event.organization_id) {
      await supabase
        .from('timeline_events')
        .update({
          organization_id: matchedOrg.id,
          service_provider_name: matchedOrg.name
        })
        .eq('id', event.id);
    }
  }

  console.log(`\n✅ Created ${linksCreated.size} organization links\n`);
}

// Main
const vehicleId = process.argv[2] || 'eea40748-cdc1-4ae9-ade1-4431d14a7726';
linkOrganizationsFromWorkCategory(vehicleId).catch(console.error);

