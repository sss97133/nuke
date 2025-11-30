/**
 * Process ALL unprocessed images across all vehicles
 * Usage: node scripts/process-all-unprocessed-images.js
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

async function processAllImages() {
  console.log('🔍 Finding ALL unprocessed images across all vehicles...\n')

  // Find images without ai_scan_metadata or with empty metadata
  const { data: images, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, created_at, ai_scan_metadata')
    .or('ai_scan_metadata.is.null,ai_scan_metadata.eq.{}')
    .order('created_at', { ascending: false })
    .limit(1000) // Process up to 1000 at a time

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
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(images.length / batchSize)
    
    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} images)...`)

    const batchPromises = batch.map(async (image) => {
      try {
        // Double-check if already processed (might have been processed by another instance)
        const { data: currentImage } = await supabase
          .from('vehicle_images')
          .select('ai_scan_metadata')
          .eq('id', image.id)
          .single()

        if (currentImage?.ai_scan_metadata?.scanned_at) {
          skipped++
          return { success: true, skipped: true }
        }

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
          console.error(`  ❌ Error processing ${image.id.substring(0, 8)}...:`, error.message)
          errors++
          return { success: false, error: error.message }
        }

        processed++
        return { success: true }

      } catch (err) {
        console.error(`  ❌ Exception processing ${image.id.substring(0, 8)}...:`, err.message)
        errors++
        return { success: false, error: err.message }
      }
    })

    await Promise.all(batchPromises)
    
    // Progress update
    const progress = ((i + batch.length) / images.length * 100).toFixed(1)
    console.log(`  📊 Progress: ${progress}% (${i + batch.length}/${images.length})`)
    
    // Wait a bit between batches to avoid rate limits
    if (i + batchSize < images.length) {
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

processAllImages().catch(console.error)

