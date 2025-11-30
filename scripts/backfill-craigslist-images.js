#!/usr/bin/env node
/**
 * Backfill images for existing Craigslist-scraped vehicles
 * Fetches the original listing URL and downloads images
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

async function downloadAndUploadImage(imageUrl, vehicleId, index, importUserId) {
  try {
    // Download image
    const imageResponse = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10000)
    })
    
    if (!imageResponse.ok) {
      throw new Error(`HTTP ${imageResponse.status}`)
    }
    
    const imageBlob = await imageResponse.blob()
    const arrayBuffer = await imageBlob.arrayBuffer()
    const uint8Array = new Uint8Array(arrayBuffer)
    
    // Generate filename
    const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg'
    const fileName = `${Date.now()}_${index}.${ext}`
    const storagePath = `${vehicleId}/${fileName}`
    
    // Upload to Supabase Storage
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
    
    // Create vehicle_images record
    const { error: imageInsertError } = await supabase
      .from('vehicle_images')
      .insert({
        vehicle_id: vehicleId,
        image_url: publicUrl,
        uploaded_by: importUserId,
        is_primary: index === 0,
        source: 'craigslist_scrape',
        metadata: {
          original_url: imageUrl,
          backfilled: true,
          backfilled_at: new Date().toISOString()
        }
      })
    
    if (imageInsertError) {
      throw imageInsertError
    }
    
    return true
  } catch (error) {
    console.error(`    ⚠️ Error: ${error.message}`)
    return false
  }
}

async function scrapeCraigslistImages(listingUrl) {
  try {
    const response = await fetch(listingUrl, {
      signal: AbortSignal.timeout(10000)
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const html = await response.text()
    const { DOMParser } = await import('https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    
    if (!doc) {
      throw new Error('Failed to parse HTML')
    }
    
    // Extract images
    const images = []
    const thumbLinks = doc.querySelectorAll('a.thumb')
    thumbLinks.forEach((link) => {
      const href = link.getAttribute('href')
      if (href && href.startsWith('http')) {
        images.push(href.replace(/\/\d+x\d+\//, '/1200x900/'))
      }
    })
    
    return Array.from(new Set(images)).slice(0, 20)
  } catch (error) {
    console.error(`  ⚠️ Failed to scrape images: ${error.message}`)
    return []
  }
}

async function backfillImages() {
  console.log('🔄 Backfilling images for Craigslist-scraped vehicles...\n')
  
  // Get vehicles without images
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select(`
      id,
      year,
      make,
      model,
      discovery_url,
      uploaded_by,
      vehicle_images(id)
    `)
    .eq('discovery_source', 'craigslist_scrape')
    .is('vehicle_images.id', null)
    .limit(20)
  
  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError)
    return
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('✅ No vehicles need image backfill')
    return
  }
  
  console.log(`Found ${vehicles.length} vehicles without images\n`)
  
  let processed = 0
  let imagesAdded = 0
  
  for (const vehicle of vehicles) {
    if (!vehicle.discovery_url) {
      console.log(`⏭️  Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} - no discovery_url`)
      continue
    }
    
    console.log(`\n📸 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`)
    console.log(`   URL: ${vehicle.discovery_url}`)
    
    // Scrape images from listing
    const imageUrls = await scrapeCraigslistImages(vehicle.discovery_url)
    
    if (imageUrls.length === 0) {
      console.log(`   ⚠️  No images found`)
      continue
    }
    
    console.log(`   Found ${imageUrls.length} images`)
    
    // Download and upload images
    let uploaded = 0
    for (let i = 0; i < imageUrls.length; i++) {
      const success = await downloadAndUploadImage(
        imageUrls[i],
        vehicle.id,
        i,
        vehicle.uploaded_by
      )
      
      if (success) {
        uploaded++
        console.log(`   ✅ Uploaded ${uploaded}/${imageUrls.length}`)
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    imagesAdded += uploaded
    processed++
    
    console.log(`   ✅ Added ${uploaded} images`)
  }
  
  console.log(`\n✅ Backfill complete!`)
  console.log(`   Processed: ${processed} vehicles`)
  console.log(`   Images added: ${imagesAdded}`)
}

backfillImages().catch(console.error)

