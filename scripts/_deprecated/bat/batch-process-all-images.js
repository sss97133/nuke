/**
 * Batch process all vehicle images that haven't been analyzed yet
 * Usage: node scripts/batch-process-all-images.js [vehicle_id]
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

// Get vehicle_id from command line args if provided
const targetVehicleId = process.argv[2] || null

async function batchProcessImages() {
  console.log('🔍 Finding unprocessed images...\n')

  // Build query to find images without ai_scan_metadata or with incomplete metadata
  let query = supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, created_at, ai_scan_metadata')
    .order('created_at', { ascending: false })

  // Filter for unprocessed images
  // Images are unprocessed if:
  // 1. ai_scan_metadata is null
  // 2. ai_scan_metadata.scanned_at is missing
  // 3. ai_scan_metadata doesn't have vin_tag or spid data (for VIN tag images)
  query = query.or('ai_scan_metadata.is.null,ai_scan_metadata.eq.{}')

  if (targetVehicleId) {
    query = query.eq('vehicle_id', targetVehicleId)
    console.log(`📋 Processing images for vehicle: ${targetVehicleId}\n`)
  }

  const { data: images, error: fetchError } = await query

  if (fetchError) {
    console.error('Error fetching images:', fetchError)
    process.exit(1)
  }

  if (!images || images.length === 0) {
    console.log('✅ No unprocessed images found!')
    process.exit(0)
  }

  console.log(`📸 Found ${images.length} unprocessed image(s)\n`)

  let processed = 0
  let errors = 0
  let skipped = 0

  // Process in batches of 5 to avoid rate limits
  const batchSize = 5
  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize)
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} images)...`)

    const batchPromises = batch.map(async (image) => {
      try {
        // Check if already processed (might have been processed by another instance)
        const { data: currentImage } = await supabase
          .from('vehicle_images')
          .select('ai_scan_metadata')
          .eq('id', image.id)
          .single()

        if (currentImage?.ai_scan_metadata?.scanned_at) {
          console.log(`⏭️  Skipping ${image.id} - already processed`)
          skipped++
          return { success: true, skipped: true }
        }

        console.log(`  🔄 Processing: ${image.id.substring(0, 8)}...`)

        // Get user_id from vehicle if available
        let userId = null
        if (image.vehicle_id) {
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('uploaded_by')
            .eq('id', image.vehicle_id)
            .maybeSingle()
          userId = vehicle?.uploaded_by || null
        }

        // Invoke analyze-image edge function
        const { data, error } = await supabase.functions.invoke('analyze-image', {
          body: {
            image_url: image.image_url,
            vehicle_id: image.vehicle_id,
            timeline_event_id: null,
            user_id: userId
          }
        })

        if (error) {
          console.error(`  ❌ Error processing ${image.id}:`, error.message)
          errors++
          return { success: false, error: error.message }
        }

        console.log(`  ✅ Processed: ${image.id.substring(0, 8)}...`)
        processed++
        return { success: true }

      } catch (err) {
        console.error(`  ❌ Exception processing ${image.id}:`, err.message)
        errors++
        return { success: false, error: err.message }
      }
    })

    const results = await Promise.all(batchPromises)
    
    // Wait a bit between batches to avoid rate limits
    if (i + batchSize < images.length) {
      console.log('  ⏳ Waiting 2 seconds before next batch...')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  console.log(`\n\n📊 Summary:`)
  console.log(`  ✅ Processed: ${processed}`)
  console.log(`  ⏭️  Skipped: ${skipped}`)
  console.log(`  ❌ Errors: ${errors}`)
  console.log(`  📸 Total: ${images.length}`)

  if (errors > 0) {
    console.log(`\n⚠️  Some images failed to process. Check logs above for details.`)
  } else {
    console.log(`\n✅ All images processed successfully!`)
  }
}

batchProcessImages().catch(console.error)

