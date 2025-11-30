/**
 * Merge two vehicle profiles
 * Moves all data from source vehicle to target vehicle
 * Usage: node scripts/merge-vehicles.js <target_vehicle_id> <source_vehicle_id>
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Vehicle IDs from command line or hardcoded
const targetVehicleId = process.argv[2] || '7176a5fc-24ae-4b42-9e65-0b96c4f9e50c'
const sourceVehicleId = process.argv[3] || '42f86016-57dc-411b-9281-552ddea84925'

async function mergeVehicles() {
  console.log(`\n🔀 Merging vehicles:`)
  console.log(`   Target (keep): ${targetVehicleId}`)
  console.log(`   Source (merge): ${sourceVehicleId}\n`)

  // Verify both vehicles exist
  const { data: targetVehicle, error: targetError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, series, trim, vin')
    .eq('id', targetVehicleId)
    .single()

  if (targetError || !targetVehicle) {
    console.error(`❌ Target vehicle not found: ${targetVehicleId}`)
    process.exit(1)
  }

  const { data: sourceVehicle, error: sourceError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, series, trim, vin')
    .eq('id', sourceVehicleId)
    .single()

  if (sourceError || !sourceVehicle) {
    console.error(`❌ Source vehicle not found: ${sourceVehicleId}`)
    process.exit(1)
  }

  console.log(`✅ Target: ${sourceVehicle.year} ${sourceVehicle.make} ${sourceVehicle.model} ${sourceVehicle.series || ''} ${sourceVehicle.trim || ''}`)
  console.log(`✅ Source: ${targetVehicle.year} ${targetVehicle.make} ${targetVehicle.model} ${targetVehicle.series || ''} ${targetVehicle.trim || ''}\n`)

  // Count data to move
  const { data: sourceImages } = await supabase
    .from('vehicle_images')
    .select('id')
    .eq('vehicle_id', sourceVehicleId)

  const { data: sourceEvents } = await supabase
    .from('timeline_events')
    .select('id')
    .eq('vehicle_id', sourceVehicleId)

  const { data: sourceOrgLinks } = await supabase
    .from('organization_vehicles')
    .select('id')
    .eq('vehicle_id', sourceVehicleId)

  const { data: sourceReceipts } = await supabase
    .from('receipts')
    .select('id')
    .eq('vehicle_id', sourceVehicleId)

  console.log(`📊 Data to move:`)
  console.log(`   - ${sourceImages?.length || 0} images`)
  console.log(`   - ${sourceEvents?.length || 0} timeline events`)
  console.log(`   - ${sourceOrgLinks?.length || 0} organization links`)
  console.log(`   - ${sourceReceipts?.length || 0} receipts\n`)

  // Step 1: Move images
  console.log(`📸 Moving images...`)
  const { error: imagesError } = await supabase
    .from('vehicle_images')
    .update({ vehicle_id: targetVehicleId })
    .eq('vehicle_id', sourceVehicleId)

  if (imagesError) {
    console.error(`❌ Error moving images:`, imagesError)
  } else {
    console.log(`✅ Moved ${sourceImages?.length || 0} images`)
  }

  // Step 2: Move timeline events
  console.log(`📅 Moving timeline events...`)
  const { error: eventsError } = await supabase
    .from('timeline_events')
    .update({ vehicle_id: targetVehicleId })
    .eq('vehicle_id', sourceVehicleId)

  if (eventsError) {
    console.error(`❌ Error moving timeline events:`, eventsError)
  } else {
    console.log(`✅ Moved ${sourceEvents?.length || 0} timeline events`)
  }

  // Step 3: Move organization links (handle duplicates)
  console.log(`🏢 Moving organization links...`)
  if (sourceOrgLinks && sourceOrgLinks.length > 0) {
    const { data: existingOrgLinks } = await supabase
      .from('organization_vehicles')
      .select('organization_id, relationship_type')
      .eq('vehicle_id', targetVehicleId)

    for (const link of sourceOrgLinks) {
      const { data: linkData } = await supabase
        .from('organization_vehicles')
        .select('organization_id, relationship_type')
        .eq('id', link.id)
        .single()

      if (linkData) {
        const duplicate = existingOrgLinks?.find(
          el => el.organization_id === linkData.organization_id &&
                el.relationship_type === linkData.relationship_type
        )

        if (!duplicate) {
          const { error: updateError } = await supabase
            .from('organization_vehicles')
            .update({ vehicle_id: targetVehicleId })
            .eq('id', link.id)

          if (updateError) {
            console.error(`❌ Error moving org link ${link.id}:`, updateError)
          }
        } else {
          // Delete duplicate
          const { error: deleteError } = await supabase
            .from('organization_vehicles')
            .delete()
            .eq('id', link.id)

          if (deleteError) {
            console.error(`❌ Error deleting duplicate org link:`, deleteError)
          }
        }
      }
    }
    console.log(`✅ Processed ${sourceOrgLinks.length} organization links`)
  } else {
    console.log(`✅ No organization links to move`)
  }

  // Step 4: Move receipts
  console.log(`🧾 Moving receipts...`)
  const { error: receiptsError } = await supabase
    .from('receipts')
    .update({ vehicle_id: targetVehicleId })
    .eq('vehicle_id', sourceVehicleId)

  if (receiptsError) {
    console.error(`❌ Error moving receipts:`, receiptsError)
  } else {
    console.log(`✅ Moved ${sourceReceipts?.length || 0} receipts`)
  }

  // Step 5: Merge vehicle data (update target with any missing data from source)
  console.log(`🔄 Merging vehicle data...`)
  const updates = {}
  
  if (!targetVehicle.vin && sourceVehicle.vin) {
    updates.vin = sourceVehicle.vin
  }
  if (!targetVehicle.series && sourceVehicle.series) {
    updates.series = sourceVehicle.series
  }
  if (!targetVehicle.trim && sourceVehicle.trim) {
    updates.trim = sourceVehicle.trim
  }

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', targetVehicleId)

    if (updateError) {
      console.error(`❌ Error updating target vehicle:`, updateError)
    } else {
      console.log(`✅ Updated target vehicle with: ${Object.keys(updates).join(', ')}`)
    }
  } else {
    console.log(`✅ No additional data to merge`)
  }

  // Step 6: Create merge timeline event
  console.log(`📝 Creating merge timeline event...`)
  const { error: mergeEventError } = await supabase
    .from('timeline_events')
    .insert({
      vehicle_id: targetVehicleId,
      event_type: 'profile_merge',
      source: 'system_merge',
      title: 'Vehicle Profile Merged',
      description: `Merged vehicle profile ${sourceVehicleId} into this profile. All data points preserved with full attribution.`,
      event_date: new Date().toISOString().split('T')[0],
      metadata: {
        merged_vehicle_id: sourceVehicleId,
        merge_reason: 'manual_merge',
        merged_at: new Date().toISOString(),
        source_vehicle: {
          year: sourceVehicle.year,
          make: sourceVehicle.make,
          model: sourceVehicle.model,
          series: sourceVehicle.series,
          trim: sourceVehicle.trim,
          vin: sourceVehicle.vin
        }
      }
    })

  if (mergeEventError) {
    console.error(`❌ Error creating merge event:`, mergeEventError)
  } else {
    console.log(`✅ Created merge timeline event`)
  }

  // Step 7: Soft delete source vehicle
  console.log(`🗑️  Archiving source vehicle...`)
  const { error: archiveError } = await supabase
    .from('vehicles')
    .update({
      is_public: false,
      status: 'archived',
      description: (sourceVehicle.description || '') + `\n\n[MERGED INTO: ${targetVehicleId} on ${new Date().toISOString()}]`
    })
    .eq('id', sourceVehicleId)

  if (archiveError) {
    console.error(`❌ Error archiving source vehicle:`, archiveError)
  } else {
    console.log(`✅ Archived source vehicle`)
  }

  console.log(`\n✅ Merge complete!`)
  console.log(`   Target vehicle: https://n-zero.dev/vehicle/${targetVehicleId}`)
  console.log(`   Source vehicle archived: ${sourceVehicleId}\n`)
}

mergeVehicles().catch(console.error)

