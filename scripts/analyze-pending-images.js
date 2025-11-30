/**
 * Analyze all images with pending AI analysis status
 * Usage: node scripts/analyze-pending-images.js [limit]
 *   - limit: max number of images to process (default: 200)
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

const limit = parseInt(process.argv[2]) || 200

async function analyzePendingImages() {
  console.log(`🔍 Finding images with pending AI analysis (max ${limit} images)...\n`)

  // Find images that need analysis:
  // 1. No ai_scan_metadata at all
  // 2. ai_scan_metadata exists but no scanned_at timestamp
  // 3. ai_processing_status is 'pending' or null
  const { data: images, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, created_at, ai_scan_metadata, ai_processing_status')
    .order('created_at', { ascending: false })
    .limit(limit * 2) // Get more to filter

  if (fetchError) {
    console.error('Error fetching images:', fetchError)
    process.exit(1)
  }

  if (!images || images.length === 0) {
    console.log('✅ No images found!')
    process.exit(0)
  }

  // Filter for pending images
  const pendingImages = images.filter(image => {
    const metadata = image.ai_scan_metadata
    const status = image.ai_processing_status
    
    // Pending if:
    // - No metadata at all
    // - Metadata exists but no scanned_at
    // - Status is 'pending' or null
    const hasMetadata = metadata && typeof metadata === 'object'
    const hasScannedAt = hasMetadata && metadata.scanned_at
    const isPendingStatus = !status || status === 'pending'
    
    return !hasScannedAt || isPendingStatus
  }).slice(0, limit)

  if (pendingImages.length === 0) {
    console.log(`✅ All ${images.length} images are already analyzed!`)
    process.exit(0)
  }

  console.log(`📸 Found ${pendingImages.length} pending image(s) out of ${images.length} total images\n`)

  let processed = 0
  let errors = 0
  let skipped = 0

  // Process in batches of 5 to avoid rate limits
  const batchSize = 5
  for (let i = 0; i < pendingImages.length; i += batchSize) {
    const batch = pendingImages.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(pendingImages.length / batchSize)
    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} images)...`)

    const batchPromises = batch.map(async (image) => {
      try {
        // Double-check if already processed (might have been processed by another instance)
        const { data: currentImage } = await supabase
          .from('vehicle_images')
          .select('ai_scan_metadata, ai_processing_status')
          .eq('id', image.id)
          .single()

        const metadata = currentImage?.ai_scan_metadata
        const hasScannedAt = metadata && metadata.scanned_at
        const status = currentImage?.ai_processing_status

        if (hasScannedAt && status === 'completed') {
          console.log(`⏭️  Skipping ${image.id.substring(0, 8)}... - already processed`)
          skipped++
          return { success: true, skipped: true }
        }

        const createdDate = new Date(image.created_at).toLocaleDateString()
        console.log(`  🔄 Processing: ${image.id.substring(0, 8)}... (created: ${createdDate})`)

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

        console.log(`  ✅ Processed: ${image.id.substring(0, 8)}...`)
        processed++
        return { success: true }

      } catch (err) {
        console.error(`  ❌ Exception processing ${image.id.substring(0, 8)}...:`, err.message)
        errors++
        return { success: false, error: err.message }
      }
    })

    const results = await Promise.all(batchPromises)
    
    // Wait a bit between batches to avoid rate limits
    if (i + batchSize < pendingImages.length) {
      console.log('  ⏳ Waiting 2 seconds before next batch...')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  console.log(`\n\n📊 Summary:`)
  console.log(`  ✅ Processed: ${processed}`)
  console.log(`  ⏭️  Skipped: ${skipped}`)
  console.log(`  ❌ Errors: ${errors}`)
  console.log(`  📸 Total: ${pendingImages.length}`)

  if (errors > 0) {
    console.log(`\n⚠️  Some images failed to process. Check logs above for details.`)
  } else if (processed > 0) {
    console.log(`\n✅ All pending images processed successfully!`)
  }
}

analyzePendingImages().catch(console.error)

