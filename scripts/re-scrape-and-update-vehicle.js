#!/usr/bin/env node
/**
 * Re-scrape Craigslist listing and update missing vehicle information
 * Uses direct DB connection to bypass recursive triggers
 */

import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

dotenv.config({ path: join(__dirname, '../.env') })

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Default values for single vehicle processing
const vehicleId = process.env.VEHICLE_ID || '2b620b41-f53e-440c-aba0-ad61ed41c4a6'
const listingUrl = process.env.LISTING_URL || 'https://sfbay.craigslist.org/sby/cto/d/gilroy-1978-gmc-high-sierra-diesel-now/7898247358.html'

// Database connection for direct SQL (bypasses triggers)
const DB_PASSWORD = 'RbzKq32A0uhqvJMQ'
const DB_URL = `postgresql://postgres.qkgaybvrernstplzjaam:${DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`

function upgradeCraigslistImageUrl(url) {
  if (!url) return url
  try {
    const sizePattern = /_(\d+x\d+)([a-z]*)\.(jpg|jpeg|png|webp)$/i
    if (sizePattern.test(url)) {
      return url.replace(sizePattern, '_1200x900.$3')
    }
  } catch (error) {
    console.warn('Failed to normalize Craigslist image URL:', error)
  }
  return url
}

export function formatDescriptionWithSource(description, sourceUrl, postedDate) {
  // Clean up the description (remove extra whitespace, normalize line breaks)
  // Remove "QR Code Link to This Post" and similar metadata
  let cleaned = description
    .replace(/QR Code Link to This Post[\s\n]*/gi, '')
    .replace(/keywords?:[^\n]*/gi, '')
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/[ \t]+/g, ' ') // Normalize spaces
    .trim()
  
  // Extract date if available
  let dateContext = ''
  if (postedDate) {
    try {
      const date = new Date(postedDate)
      dateContext = ` (Posted ${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})`
    } catch (e) {
      // Ignore date parsing errors
    }
  }
  
  // Don't add source attribution to the description itself - it's tracked in metadata
  // The component will display the source link separately
  return cleaned
}

export async function scrapeListing(listingUrlParam = listingUrl, vehicleIdParam = vehicleId) {
  console.log('🔍 Scraping Craigslist listing...\n')
  
  const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('scrape-vehicle', {
    body: { url: listingUrlParam }
  })
  
  if (scrapeError || !scrapeData?.success) {
    throw new Error(`Failed to scrape listing: ${scrapeError?.message || 'Unknown error'}`)
  }
  
  // Also fetch HTML directly to extract VIN if scraper missed it
  if (!scrapeData.data.vin) {
    console.log('   ⚠️  VIN not found by scraper, trying direct HTML extraction...')
    try {
      const response = await fetch(listingUrlParam, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })
      const html = await response.text()
      
      // Extract VIN from HTML - check multiple patterns
      const vinPatterns = [
        // Pattern 1: VIN: TCZ148Z533444 (simple)
        /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
        // Pattern 2: In auto_vin div
        /<div[^>]*class="[^"]*auto_vin[^"]*"[^>]*>[\s\S]*?VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
        // Pattern 3: In attr.auto_vin
        /class="[^"]*attr[^"]*auto_vin[^"]*"[^>]*>[\s\S]*?VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i,
        // Pattern 4: In mapAndAttrs section
        /mapAndAttrs[^>]*>[\s\S]{0,500}?VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i
      ]
      
      for (const pattern of vinPatterns) {
        const match = html.match(pattern)
        if (match && match[1] && match[1].length === 17 && !/[IOQ]/.test(match[1])) {
          scrapeData.data.vin = match[1].toUpperCase()
          console.log(`   ✅ Found VIN in HTML: ${scrapeData.data.vin}`)
          break
        }
      }
      
      // Also try global search
      if (!scrapeData.data.vin) {
        const globalPattern = /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/gi
        let match
        while ((match = globalPattern.exec(html)) !== null) {
          if (match[1] && match[1].length === 17 && !/[IOQ]/.test(match[1])) {
            scrapeData.data.vin = match[1].toUpperCase()
            console.log(`   ✅ Found VIN in HTML (global search): ${scrapeData.data.vin}`)
            break
          }
        }
      }
      
      // Last resort: search for any 17-char VIN pattern in the text
      if (!scrapeData.data.vin) {
        const allVins = html.match(/\b([A-HJ-NPR-Z0-9]{17})\b/g)
        if (allVins) {
          for (const vin of allVins) {
            if (!/[IOQ]/.test(vin) && vin.length === 17) {
              // Check if it's near "VIN" text
              const vinIndex = html.indexOf(vin)
              const beforeText = html.substring(Math.max(0, vinIndex - 50), vinIndex).toLowerCase()
              if (beforeText.includes('vin') || beforeText.includes('vehicle identification')) {
                scrapeData.data.vin = vin.toUpperCase()
                console.log(`   ✅ Found VIN near VIN text: ${scrapeData.data.vin}`)
                break
              }
            }
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Could not extract VIN from HTML: ${error.message}`)
    }
  }
  
  // If still no VIN, use known VIN from this specific listing (remove hardcoded check for production)
  // if (!scrapeData.data.vin && listingUrlParam.includes('7898247358')) {
  //   scrapeData.data.vin = 'TCZ148Z533444'
  //   console.log(`   ✅ Using known VIN for this listing: ${scrapeData.data.vin}`)
  // }
  
  // Fix trim if scraper got it wrong - check title for "High Sierra"
  if (scrapeData.data.title && scrapeData.data.title.includes('High Sierra')) {
    if (scrapeData.data.trim !== 'High Sierra') {
      console.log(`   📝 Correcting trim: ${scrapeData.data.trim || 'None'} → High Sierra (from title)`)
      scrapeData.data.trim = 'High Sierra'
    }
  }
  
  return scrapeData.data
}

export async function getCurrentVehicle(vehicleIdParam = vehicleId) {
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single()
  
  if (error) throw error
  return data
}

export async function createDiscoveryTimelineEvent(vehicleIdParam, listingUrlParam, scrapedData, userId) {
  try {
    console.log('\n📋 Step 5: Creating/updating discovery timeline event...')
    
    // Parse the posted date from the listing - try multiple formats
    let eventDate = new Date().toISOString().split('T')[0] // Default to today
    let eventDateTime = null
    
    // Try to extract date from listing URL or scraped data
    if (scrapedData.posted_date) {
      try {
        // Format: "2025-11-25 08:46" or "2025-11-25T08:46:29-0800"
        let dateStr = scrapedData.posted_date
        // Handle timezone offset format
        if (dateStr.includes('T') && dateStr.includes('-0')) {
          // ISO format with timezone: "2025-11-25T08:46:29-0800"
          eventDateTime = new Date(dateStr)
        } else {
          // Simple format: "2025-11-25 08:46"
          eventDateTime = new Date(dateStr.replace(' ', 'T'))
        }
        
        if (eventDateTime && !isNaN(eventDateTime.getTime())) {
          eventDate = eventDateTime.toISOString().split('T')[0]
        }
      } catch (e) {
        // Try alternative parsing
        try {
          const altDate = new Date(scrapedData.posted_date)
          if (!isNaN(altDate.getTime())) {
            eventDate = altDate.toISOString().split('T')[0]
            eventDateTime = altDate
          }
        } catch (e2) {
          // Use default
        }
      }
    }
    
    // Check if listing event already exists
    const { data: existingEvents } = await supabase
      .from('timeline_events')
      .select('id, event_date, title')
      .eq('vehicle_id', vehicleIdParam)
      .eq('event_type', 'listing')
      .or(`source.eq.craigslist_listing,source.eq.craigslist,metadata->>listing_url.eq.${listingUrlParam}`)
      .limit(1)
    
    const postId = listingUrlParam.match(/\/d\/[^\/]+\/(\d+)\.html/)?.[1] || null
    
    // Use 'other' event type (always allowed) for Craigslist listing discovery
    const eventData = {
      vehicle_id: vehicleIdParam,
      user_id: userId,
      event_type: 'other', // Use 'other' which is always allowed
      source: 'craigslist_listing',
      event_date: eventDate,
      title: 'Listed on Craigslist',
      description: `Vehicle listed for sale on Craigslist${scrapedData.asking_price ? ` for $${scrapedData.asking_price.toLocaleString()}` : ''}${scrapedData.location ? ` in ${scrapedData.location}` : ''}`,
      metadata: {
        listing_url: listingUrlParam,
        asking_price: scrapedData.asking_price,
        location: scrapedData.location,
        posted_date: scrapedData.posted_date,
        updated_date: scrapedData.updated_date,
        post_id: postId,
        image_count: scrapedData.images?.length || 0,
        extracted_at: new Date().toISOString(),
        source_type: 'craigslist_listing',
        discovery: true // Mark as discovery event in metadata
      },
      image_urls: scrapedData.images?.slice(0, 5) || [] // Link first 5 images to the event
    }
    
    if (existingEvents && existingEvents.length > 0) {
      // Update existing event with latest data
      const { error: updateError } = await supabase
        .from('timeline_events')
        .update({
          ...eventData,
          event_date: eventDate // Update to correct posted date
        })
        .eq('id', existingEvents[0].id)
      
      if (updateError) {
        console.log(`   ⚠️  Could not update timeline event: ${updateError.message}`)
      } else {
        console.log(`   ✅ Updated discovery timeline event`)
        console.log(`      Event Date: ${eventDate}${eventDateTime ? ` (${eventDateTime.toLocaleString()})` : ''}`)
        console.log(`      Title: ${eventData.title}`)
      }
    } else {
      // Create new event
      const { error: insertError } = await supabase
        .from('timeline_events')
        .insert([eventData])
      
      if (insertError) {
        console.log(`   ⚠️  Could not create timeline event: ${insertError.message}`)
        console.log(`      Error details:`, insertError)
      } else {
        console.log(`   ✅ Created discovery timeline event`)
        console.log(`      Event Date: ${eventDate}${eventDateTime ? ` (${eventDateTime.toLocaleString()})` : ''}`)
        console.log(`      Title: ${eventData.title}`)
        console.log(`      Post ID: ${postId || 'N/A'}`)
      }
    }
  } catch (error) {
    console.log(`   ⚠️  Error creating timeline event: ${error.message}`)
    console.log(`      Stack:`, error.stack)
  }
}

export async function trackDescriptionSource(vehicleIdParam, sourceUrl, imageCount) {
  try {
    // Track description source in vehicle_field_sources table
    // Check which columns exist and use appropriate schema
      const sourceData = {
        vehicle_id: vehicleIdParam,
      field_name: 'description',
      field_value: 'craigslist_listing',
      source_type: 'ai_scraped',
      source_url: sourceUrl,
      confidence_score: 85,
      extraction_method: 'url_scraping',
      metadata: {
        image_count: imageCount,
        extracted_at: new Date().toISOString(),
        listing_type: 'for_sale',
        source_name: 'Craigslist'
      }
    }
    
    // Try upsert - handle different schema versions
    const { error } = await supabase
      .from('vehicle_field_sources')
      .upsert(sourceData, {
        onConflict: 'vehicle_id,field_name'
      })
    
    if (error) {
      // If table doesn't exist or has different schema, that's okay
      // The description is still saved in vehicles.description
      console.log(`   ℹ️  Description source tracking skipped: ${error.message}`)
    } else {
      console.log(`   ✅ Tracked description source in vehicle_field_sources`)
    }
  } catch (error) {
    // Non-critical - description is still saved
    console.log(`   ℹ️  Description source tracking skipped: ${error.message}`)
  }
}

export async function updateVehicleDirectSQL(updates, vehicleIdParam = vehicleId) {
  const client = new pg.Client({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false }
  })
  
  try {
    await client.connect()
    console.log('✅ Connected to database\n')
    
    // Check if we're updating VIN - if so, disable all triggers temporarily
    const updatingVIN = 'vin' in updates
    let disabledTriggers = []
    
    if (updatingVIN) {
      console.log('   ⚠️  Updating VIN - temporarily disabling triggers...')
      // Get all triggers on vehicles table
      const triggerResult = await client.query(`
        SELECT trigger_name 
        FROM information_schema.triggers 
        WHERE event_object_table = 'vehicles'
        AND trigger_schema = 'public'
      `)
      
      // Disable all triggers
      for (const row of triggerResult.rows) {
        try {
          await client.query(`ALTER TABLE vehicles DISABLE TRIGGER ${row.trigger_name}`)
          disabledTriggers.push(row.trigger_name)
        } catch (e) {
          // Ignore errors for triggers that don't exist or can't be disabled
        }
      }
      console.log(`   Disabled ${disabledTriggers.length} trigger(s)`)
    }
    
    try {
      // Build UPDATE query
      const setClauses = []
      const values = []
      let paramIndex = 1
      
      for (const [key, value] of Object.entries(updates)) {
        setClauses.push(`${key} = $${paramIndex}`)
        values.push(value)
        paramIndex++
      }
      
      setClauses.push(`updated_at = NOW()`)
      
      const query = `
        UPDATE vehicles
        SET ${setClauses.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING id, year, make, model, vin, series, trim, displacement, engine_size, description, description_source
      `
      values.push(vehicleIdParam)
      
      const result = await client.query(query, values)
      
      return result.rows[0]
    } finally {
      // Re-enable triggers if we disabled them
      if (updatingVIN && disabledTriggers.length > 0) {
        for (const triggerName of disabledTriggers) {
          try {
            await client.query(`ALTER TABLE vehicles ENABLE TRIGGER ${triggerName}`)
          } catch (e) {
            // Ignore errors
          }
        }
        console.log(`   ✅ Re-enabled ${disabledTriggers.length} trigger(s)`)
      }
    }
  } finally {
    await client.end()
  }
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🔄 Re-scrape and Update Vehicle')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log(`Vehicle ID: ${vehicleId}`)
  console.log(`Listing URL: ${listingUrl}\n`)
  
  // Step 1: Get current vehicle data
  console.log('📋 Step 1: Getting current vehicle data...')
  const currentVehicle = await getCurrentVehicle()
  console.log(`   Current: ${currentVehicle.year} ${currentVehicle.make} ${currentVehicle.model}`)
  console.log(`   VIN: ${currentVehicle.vin || 'None'}`)
  console.log(`   Series: ${currentVehicle.series || 'None'}`)
  console.log(`   Trim: ${currentVehicle.trim || 'None'}\n`)
  
  // Step 2: Scrape listing
  console.log('📋 Step 2: Scraping listing for latest data...')
  const scrapedData = await scrapeListing(listingUrl, vehicleId)
  console.log(`   ✅ Scraped: ${scrapedData.year} ${scrapedData.make} ${scrapedData.model || scrapedData.series}`)
  console.log(`   VIN: ${scrapedData.vin || 'Not found'}`)
  console.log(`   Series: ${scrapedData.series || 'Not found'}`)
  console.log(`   Trim: ${scrapedData.trim || 'Not found'}`)
  console.log(`   Images: ${scrapedData.images?.length || 0} found\n`)
  
  // Step 3: Compare and identify missing fields
  console.log('📋 Step 3: Comparing data and identifying missing fields...\n')
  const updates = {}
  
  // VIN
  if (scrapedData.vin && (!currentVehicle.vin || currentVehicle.vin !== scrapedData.vin)) {
    updates.vin = scrapedData.vin
    console.log(`   📝 VIN: ${currentVehicle.vin || 'None'} → ${scrapedData.vin}`)
  }
  
  // Series
  if (scrapedData.series && (!currentVehicle.series || currentVehicle.series !== scrapedData.series)) {
    updates.series = scrapedData.series
    console.log(`   📝 Series: ${currentVehicle.series || 'None'} → ${scrapedData.series}`)
  }
  
  // Trim
  if (scrapedData.trim && (!currentVehicle.trim || currentVehicle.trim !== scrapedData.trim)) {
    updates.trim = scrapedData.trim
    console.log(`   📝 Trim: ${currentVehicle.trim || 'None'} → ${scrapedData.trim}`)
  }
  
  // Displacement
  if (scrapedData.displacement) {
    const scrapedDisp = String(scrapedData.displacement).replace('L', '').trim()
    const currentDisp = currentVehicle.displacement ? String(currentVehicle.displacement).replace('L', '').trim() : null
    if (currentDisp !== scrapedDisp) {
      updates.displacement = scrapedDisp
      console.log(`   📝 Displacement: ${currentDisp || 'None'} → ${scrapedDisp}L`)
    }
  }
  
  // Engine Size
  if (scrapedData.engine_size && (!currentVehicle.engine_size || currentVehicle.engine_size !== scrapedData.engine_size)) {
    updates.engine_size = scrapedData.engine_size
    console.log(`   📝 Engine Size: ${currentVehicle.engine_size || 'None'} → ${scrapedData.engine_size}`)
  }
  
  // Color
  if (scrapedData.color && (!currentVehicle.color || currentVehicle.color !== scrapedData.color)) {
    updates.color = scrapedData.color
    console.log(`   📝 Color: ${currentVehicle.color || 'None'} → ${scrapedData.color}`)
  }
  
  // Mileage
  if (scrapedData.mileage && currentVehicle.mileage !== scrapedData.mileage) {
    updates.mileage = scrapedData.mileage
    console.log(`   📝 Mileage: ${currentVehicle.mileage || 'None'} → ${scrapedData.mileage}`)
  }
  
  // Asking Price
  if (scrapedData.asking_price && currentVehicle.asking_price !== scrapedData.asking_price) {
    updates.asking_price = scrapedData.asking_price
    console.log(`   📝 Asking Price: $${currentVehicle.asking_price || 'None'} → $${scrapedData.asking_price}`)
  }
  
  // Body Style
  if (scrapedData.body_style && (!currentVehicle.body_style || currentVehicle.body_style !== scrapedData.body_style)) {
    updates.body_style = scrapedData.body_style
    console.log(`   📝 Body Style: ${currentVehicle.body_style || 'None'} → ${scrapedData.body_style}`)
  }
  
  // Transmission
  if (scrapedData.transmission && (!currentVehicle.transmission || currentVehicle.transmission !== scrapedData.transmission)) {
    updates.transmission = scrapedData.transmission
    console.log(`   📝 Transmission: ${currentVehicle.transmission || 'None'} → ${scrapedData.transmission}`)
  }
  
  // Drivetrain
  if (scrapedData.drivetrain && (!currentVehicle.drivetrain || currentVehicle.drivetrain !== scrapedData.drivetrain)) {
    updates.drivetrain = scrapedData.drivetrain
    console.log(`   📝 Drivetrain: ${currentVehicle.drivetrain || 'None'} → ${scrapedData.drivetrain}`)
  }
  
  // Fuel Type
  if (scrapedData.fuel_type && (!currentVehicle.fuel_type || currentVehicle.fuel_type !== scrapedData.fuel_type)) {
    updates.fuel_type = scrapedData.fuel_type
    console.log(`   📝 Fuel Type: ${currentVehicle.fuel_type || 'None'} → ${scrapedData.fuel_type}`)
  }
  
  // Description - extract full description and add source context
  if (scrapedData.description && scrapedData.description.trim().length > 0) {
    const scrapedDesc = scrapedData.description.trim()
    const currentDesc = currentVehicle.description || ''
    
    // If no description exists, or if the scraped one is significantly different/longer
    if (!currentDesc || currentDesc.length < scrapedDesc.length * 0.5) {
      // Format description with source attribution
      const formattedDescription = formatDescriptionWithSource(
        scrapedDesc,
        listingUrl,
        scrapedData.posted_date || scrapedData.updated_date
      )
      
      updates.description = formattedDescription
      updates.description_source = 'craigslist_listing'
      updates.description_generated_at = new Date().toISOString()
      
      console.log(`   📝 Description: ${currentDesc ? `${currentDesc.length} chars` : 'None'} → ${formattedDescription.length} chars (from CL listing)`)
    } else {
      console.log(`   ℹ️  Description already exists (${currentDesc.length} chars), keeping existing`)
    }
  }
  
  if (Object.keys(updates).length === 0) {
    console.log('   ✅ All fields are up to date!\n')
  } else {
    console.log(`\n📤 Step 4: Updating ${Object.keys(updates).length} field(s) via direct SQL...\n`)
    
    try {
      const updated = await updateVehicleDirectSQL(updates)
      console.log('✅ Vehicle updated successfully!')
      console.log(`\n   Updated Vehicle:`)
      console.log(`   ${updated.year} ${updated.make} ${updated.model}`)
      console.log(`   VIN: ${updated.vin || 'None'}`)
      console.log(`   Series: ${updated.series || 'None'}`)
      console.log(`   Trim: ${updated.trim || 'None'}`)
      if (updated.displacement) console.log(`   Displacement: ${updated.displacement}L`)
      if (updated.engine_size) console.log(`   Engine: ${updated.engine_size}`)
      if (updated.description) {
        const descPreview = updated.description.substring(0, 100).replace(/\n/g, ' ')
        console.log(`   Description: ${descPreview}... (${updated.description.length} chars)`)
        console.log(`   Description Source: ${updated.description_source || 'None'}`)
      }
      
      // Track description source in vehicle_field_sources if description was updated
      if (updates.description) {
        await trackDescriptionSource(vehicleId, listingUrl, scrapedData.images?.length || 0)
      }
    } catch (error) {
      console.error('❌ Update failed:', error.message)
      throw error
    }
  }
  
  // Always create/update timeline event for Craigslist listing discovery (even if no other updates)
  await createDiscoveryTimelineEvent(vehicleId, listingUrl, scrapedData, currentVehicle.user_id)
  
  // Step 5: Check for missing images
  console.log('\n📋 Step 5: Checking for missing images...')
  const { data: existingImages } = await supabase
    .from('vehicle_images')
    .select('id, image_url, source_url')
    .eq('vehicle_id', vehicleId)
  
  const existingUrls = new Set(
    (existingImages || [])
      .map(img => {
        // Normalize URLs for comparison
        const url = img.source_url || img.image_url
        return upgradeCraigslistImageUrl(url)
      })
      .filter(Boolean)
  )
  
  const scrapedImageUrls = (scrapedData.images || []).map(upgradeCraigslistImageUrl)
  const missingImages = scrapedImageUrls.filter(url => !existingUrls.has(url))
  
  if (missingImages.length > 0) {
    console.log(`   ⚠️  Found ${missingImages.length} missing images`)
    console.log(`   Run: node scripts/import-craigslist-images-for-vehicle.js ${vehicleId} "${listingUrl}"`)
  } else {
    console.log(`   ✅ All ${scrapedImageUrls.length} images are present`)
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✅ Process complete!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

// Only run main if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('re-scrape-and-update-vehicle.js')) {
  main().catch(console.error)
}

main().catch(error => {
  console.error('\n❌ Error:', error.message)
  console.error(error)
  process.exit(1)
})

