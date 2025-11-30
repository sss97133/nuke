/**
 * Analyze recent vehicle images that haven't been analyzed yet
 * Usage: node scripts/analyze-recent-images.js [limit] [hours] [--force]
 *   - limit: max number of images to process (default: 50)
 *   - hours: only process images from last N hours (default: 24, use 0 for all time)
 *   - --force: re-analyze even if already processed
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

const args = process.argv.slice(2)
const force = args.includes('--force')
const limitArg = args.find(arg => !isNaN(parseInt(arg)) && !arg.includes('--'))
const hoursArg = args.find((arg, i) => !isNaN(parseInt(arg)) && arg !== limitArg && !arg.includes('--'))

const limit = limitArg ? parseInt(limitArg) : 50
const hours = hoursArg ? parseInt(hoursArg) : 24

async function analyzeRecentImages() {
  const timeFilter = hours > 0 ? `last ${hours} hours` : 'all time'
  const forceText = force ? ' (FORCE RE-ANALYSIS)' : ''
  console.log(`🔍 Finding recent unprocessed images (${timeFilter}, max ${limit} images)${forceText}...\n`)

  // Build query
  let query = supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, created_at, ai_scan_metadata')
    .order('created_at', { ascending: false })

  // Apply time filter if hours > 0
  if (hours > 0) {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    query = query.gte('created_at', cutoffTime)
  }

  // Get more images to filter out already processed ones
  query = query.limit(limit * 2)

  const { data: images, error: fetchError } = await query

  if (fetchError) {
    console.error('Error fetching images:', fetchError)
    process.exit(1)
  }

  if (!images || images.length === 0) {
    console.log('✅ No recent images found!')
    process.exit(0)
  }

  // Filter out already processed images (unless force is enabled)
  const unprocessedImages = images.filter(image => {
    if (force) return true // Force re-analysis
    const metadata = image.ai_scan_metadata
    return !metadata || !metadata.scanned_at
  }).slice(0, limit)

  if (unprocessedImages.length === 0) {
    console.log(`✅ All ${images.length} recent images are already processed!`)
    process.exit(0)
  }

  console.log(`📸 Found ${unprocessedImages.length} unprocessed image(s) out of ${images.length} recent images\n`)

  let processed = 0
  let errors = 0
  let skipped = 0

  // Process in batches of 5 to avoid rate limits
  const batchSize = 5
  for (let i = 0; i < unprocessedImages.length; i += batchSize) {
    const batch = unprocessedImages.slice(i, i + batchSize)
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} images)...`)

    const batchPromises = batch.map(async (image) => {
      try {
        // Double-check if already processed (unless force is enabled)
        if (!force) {
          const { data: currentImage } = await supabase
            .from('vehicle_images')
            .select('ai_scan_metadata')
            .eq('id', image.id)
            .single()

          if (currentImage?.ai_scan_metadata?.scanned_at) {
            console.log(`⏭️  Skipping ${image.id.substring(0, 8)}... - already processed`)
            skipped++
            return { success: true, skipped: true }
          }
        }

        console.log(`  🔄 Processing: ${image.id.substring(0, 8)}... (created: ${new Date(image.created_at).toLocaleString()})`)

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
    if (i + batchSize < unprocessedImages.length) {
      console.log('  ⏳ Waiting 2 seconds before next batch...')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  console.log(`\n\n📊 Summary:`)
  console.log(`  ✅ Processed: ${processed}`)
  console.log(`  ⏭️  Skipped: ${skipped}`)
  console.log(`  ❌ Errors: ${errors}`)
  console.log(`  📸 Total: ${unprocessedImages.length}`)

  if (errors > 0) {
    console.log(`\n⚠️  Some images failed to process. Check logs above for details.`)
  } else if (processed > 0) {
    console.log(`\n✅ All images processed successfully!`)
  }
}

analyzeRecentImages().catch(console.error)

