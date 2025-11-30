#!/usr/bin/env node
/**
 * Import all images from a Craigslist listing for a specific vehicle
 * Usage: node scripts/import-craigslist-images-for-vehicle.js <vehicle_id> <craigslist_url>
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '../.env') })

const supabaseUrl = process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Get vehicle ID and URL from command line
const vehicleId = process.argv[2]
const listingUrl = process.argv[3]

if (!vehicleId || !listingUrl) {
  console.error('Usage: node scripts/import-craigslist-images-for-vehicle.js <vehicle_id> <craigslist_url>')
  process.exit(1)
}

function upgradeCraigslistImageUrl(url) {
  if (!url) return url
  try {
    const sizePattern = /_(\d+x\d+)([a-z]*)\.(jpg|jpeg|png|webp)$/i
    if (sizePattern.test(url)) {
      return url.replace(sizePattern, '_1200x900.$3')
    }
  } catch (error) {
    console.warn('Failed to normalize Craigslist image URL, using original:', error)
  }
  return url
}


async function downloadAndUploadImage(imageUrl, vehicleId, index, userId) {
  try {
    // Check if image already exists
    const { data: existingImages } = await supabase
      .from('vehicle_images')
      .select('id, image_url')
      .eq('vehicle_id', vehicleId)
    
    const imageUrlNormalized = upgradeCraigslistImageUrl(imageUrl)
    const alreadyExists = existingImages?.some(img => 
      img.image_url.includes(imageUrlNormalized.split('/').pop()) ||
      (img.metadata?.original_url && upgradeCraigslistImageUrl(img.metadata.original_url) === imageUrlNormalized)
    )
    
    if (alreadyExists) {
      console.log(`   ⏭️  Image ${index + 1} already exists, skipping`)
      return false
    }
    
    // Download image
    console.log(`   📥 Downloading image ${index + 1}...`)
    const imageResponse = await fetch(imageUrlNormalized, {
      signal: AbortSignal.timeout(15000)
    })
    
    if (!imageResponse.ok) {
      throw new Error(`HTTP ${imageResponse.status}`)
    }
    
    const imageBlob = await imageResponse.blob()
    const arrayBuffer = await imageBlob.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Generate filename
    const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg'
    const fileName = `craigslist_${Date.now()}_${index}.${ext}`
    const storagePath = `${vehicleId}/${fileName}`
    
    // Upload to Supabase Storage
    console.log(`   📤 Uploading image ${index + 1}...`)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(storagePath, uint8Array, {
        contentType: `image/${ext}`,
        cacheControl: '3600',
        upsert: false
      })
    
    if (uploadError) {
      throw uploadError
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(storagePath)
    
    // Check if this should be primary (first image and no primary exists)
    const { data: primaryCheck } = await supabase
      .from('vehicle_images')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('is_primary', true)
      .limit(1)
    
    const isPrimary = index === 0 && (!primaryCheck || primaryCheck.length === 0)
    
    // Create vehicle_images record
    const { error: imageInsertError } = await supabase
      .from('vehicle_images')
      .insert({
        vehicle_id: vehicleId,
        image_url: publicUrl,
        user_id: userId,
        is_primary: isPrimary,
        source: 'craigslist_scrape',
        source_url: imageUrlNormalized
      })
    
    if (imageInsertError) {
      throw imageInsertError
    }
    
    console.log(`   ✅ Uploaded image ${index + 1}`)
    return true
  } catch (error) {
    console.error(`   ⚠️ Error uploading image ${index + 1}: ${error.message}`)
    return false
  }
}

async function importImages() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📸 Importing Craigslist Images & VIN')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log(`Vehicle ID: ${vehicleId}`)
  console.log(`Listing URL: ${listingUrl}\n`)
  
  // Get vehicle info
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, user_id, vin')
    .eq('id', vehicleId)
    .single()
  
  if (vehicleError || !vehicle) {
    console.error(`❌ Vehicle not found: ${vehicleError?.message}`)
    process.exit(1)
  }
  
  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`)
  console.log(`Current VIN: ${vehicle.vin || 'None'}\n`)
  
  // Get existing image count
  const { data: existingImages } = await supabase
    .from('vehicle_images')
    .select('id')
    .eq('vehicle_id', vehicleId)
  
  console.log(`Current images: ${existingImages?.length || 0}\n`)
  
  // Scrape data from listing (includes images and VIN)
  console.log('🔍 Scraping listing data...')
  const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: listingUrl }
  })
  
  if (scrapeError || !scrapeData?.success) {
    console.error(`❌ Failed to scrape listing: ${scrapeError?.message || 'Unknown error'}`)
    process.exit(1)
  }
  
  // Update VIN if found and vehicle doesn't have one
  if (scrapeData.data.vin && !vehicle.vin) {
    console.log(`📝 Updating VIN: ${scrapeData.data.vin}`)
    // Use RPC or direct update with service role (bypasses RLS)
    const { error: vinError } = await supabase.rpc('update_vehicle_vin', {
      p_vehicle_id: vehicleId,
      p_vin: scrapeData.data.vin
    }).catch(async () => {
      // Fallback: direct update (service role should bypass RLS)
      return await supabase
        .from('vehicles')
        .update({ vin: scrapeData.data.vin })
        .eq('id', vehicleId)
    })
    
    if (vinError) {
      console.warn(`⚠️  Failed to update VIN: ${vinError.message}`)
      console.log(`   You can manually update VIN: ${scrapeData.data.vin}`)
    } else {
      console.log(`✅ VIN updated successfully\n`)
    }
  } else if (scrapeData.data.vin && vehicle.vin) {
    console.log(`ℹ️  VIN already exists (${vehicle.vin}), skipping update\n`)
  } else if (!scrapeData.data.vin) {
    console.log(`ℹ️  No VIN found in listing\n`)
  }
  
  // Get image URLs
  const imageUrls = scrapeData.data.images || []
  
  if (imageUrls.length === 0) {
    console.log('❌ No images found in listing')
    process.exit(1)
  }
  
  // Upgrade all image URLs to high-res
  const highResImages = imageUrls.map(upgradeCraigslistImageUrl)
  const uniqueImages = Array.from(new Set(highResImages))
  
  console.log(`✅ Found ${uniqueImages.length} unique images\n`)
  console.log(`📥 Downloading and uploading ${uniqueImages.length} images...\n`)
  
  // Download and upload images
  let uploaded = 0
  let skipped = 0
  
  for (let i = 0; i < uniqueImages.length; i++) {
    const success = await downloadAndUploadImage(
      uniqueImages[i],
      vehicleId,
      i,
      vehicle.user_id
    )
    
    if (success) {
      uploaded++
    } else {
      skipped++
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`✅ Import complete!`)
  console.log(`   Uploaded: ${uploaded} images`)
  console.log(`   Skipped: ${skipped} images`)
  console.log(`   Total: ${uniqueImages.length} images found`)
  if (scrapeData.data.vin && !vehicle.vin) {
    console.log(`   VIN: ${scrapeData.data.vin} (updated)`)
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

importImages().catch(console.error)

