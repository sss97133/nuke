/**
 * Move image from one vehicle to another
 * Usage: deno run --allow-net --allow-env scripts/move-vehicle-image.ts
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  Deno.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const sourceVehicleId = '89afcc13-febb-4a79-a4ad-533471c2062f'
const targetVehicleId = '05f27cc4-914e-425a-8ed8-cfea35c1928d'

async function moveImages() {
  console.log(`Moving images from vehicle ${sourceVehicleId} to ${targetVehicleId}...`)

  // Get all images from source vehicle
  const { data: sourceImages, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('vehicle_id', sourceVehicleId)

  if (fetchError) {
    console.error('Error fetching source images:', fetchError)
    Deno.exit(1)
  }

  if (!sourceImages || sourceImages.length === 0) {
    console.log('No images found on source vehicle')
    Deno.exit(0)
  }

  console.log(`Found ${sourceImages.length} image(s) to move`)

  // Move each image to target vehicle
  let moved = 0
  let errors = 0

  for (const image of sourceImages) {
    console.log(`Moving image: ${image.file_name || image.id}`)

    // Update vehicle_id to target vehicle
    const { error: updateError } = await supabase
      .from('vehicle_images')
      .update({
        vehicle_id: targetVehicleId,
        // Update metadata to note the transfer
        metadata: {
          ...(image.metadata || {}),
          transferred_from: sourceVehicleId,
          transferred_at: new Date().toISOString()
        }
      })
      .eq('id', image.id)

    if (updateError) {
      console.error(`Error moving image ${image.id}:`, updateError)
      errors++
    } else {
      console.log(`✓ Moved: ${image.file_name || image.id}`)
      moved++
    }
  }

  console.log(`\n✅ Moved ${moved}/${sourceImages.length} images`)
  if (errors > 0) {
    console.log(`⚠️  ${errors} errors`)
  }

  // Check if source vehicle has any remaining images or other data
  const { data: remainingImages } = await supabase
    .from('vehicle_images')
    .select('id')
    .eq('vehicle_id', sourceVehicleId)
    .limit(1)

  const { data: timelineEvents } = await supabase
    .from('timeline_events')
    .select('id')
    .eq('vehicle_id', sourceVehicleId)
    .limit(1)

  const { data: receipts } = await supabase
    .from('receipts')
    .select('id')
    .eq('vehicle_id', sourceVehicleId)
    .limit(1)

  if (!remainingImages?.length && !timelineEvents?.length && !receipts?.length) {
    console.log('\n📋 Source vehicle appears to have no other data')
    console.log('   Consider archiving or deleting it if it has no value')
  } else {
    console.log('\n📋 Source vehicle still has other data:')
    if (remainingImages?.length) console.log(`   - ${remainingImages.length} image(s)`)
    if (timelineEvents?.length) console.log(`   - Timeline events`)
    if (receipts?.length) console.log(`   - Receipts`)
  }
}

moveImages().catch(console.error)

