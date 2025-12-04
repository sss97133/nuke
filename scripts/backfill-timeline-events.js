#!/usr/bin/env node
/**
 * Backfill timeline events for vehicles that are missing them.
 * Creates events for:
 * - Profile creation
 * - Photos added (grouped by date)
 * - Listing discovered (for scraped vehicles)
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
  console.error('SUPABASE_SERVICE_ROLE_KEY not found')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Map profile origins to display names
const SOURCE_NAMES = {
  'craigslist_scrape': 'Craigslist',
  'bat_import': 'Bring a Trailer',
  'ksl_import': 'KSL Cars',
  'classiccars_import': 'ClassicCars.com',
  'url_scraper': 'Web Scrape',
  'dropbox_import': 'Dropbox Import',
  'manual_entry': 'Manual Entry',
  'user_upload': 'User Upload'
}

async function getVehiclesWithoutTimeline() {
  // Get all vehicles
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model, profile_origin, discovery_source, discovery_url, source, asking_price, created_at, uploaded_by, origin_metadata')
    .order('created_at', { ascending: false })

  // Get vehicles that have timeline events
  const { data: events } = await supabase
    .from('timeline_events')
    .select('vehicle_id')
  
  const vehiclesWithEvents = new Set(events?.map(e => e.vehicle_id))
  
  // Filter to vehicles without events
  return vehicles?.filter(v => !vehiclesWithEvents.has(v.id)) || []
}

async function getVehicleImages(vehicleId) {
  const { data } = await supabase
    .from('vehicle_images')
    .select('id, image_url, created_at, source, source_url')
    .eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: true })
  
  return data || []
}

async function createTimelineEvent(event) {
  const { error } = await supabase
    .from('timeline_events')
    .insert(event)
  
  if (error) {
    console.error(`  Error creating event: ${error.message}`)
    return false
  }
  return true
}

async function backfillVehicle(vehicle) {
  const origin = vehicle.profile_origin || vehicle.discovery_source || 'manual_entry'
  const sourceName = SOURCE_NAMES[origin] || origin
  const images = await getVehicleImages(vehicle.id)
  
  console.log(`\n${vehicle.year} ${vehicle.make} ${vehicle.model} (${sourceName})`)
  console.log(`  Images: ${images.length}, Origin: ${origin}`)
  
  let eventsCreated = 0
  
  // 1. Create "Profile Created" or "Listing Discovered" event
  if (vehicle.discovery_url) {
    // Scraped vehicle - create listing event
    const success = await createTimelineEvent({
      vehicle_id: vehicle.id,
      user_id: vehicle.uploaded_by,
      event_type: 'auction_listed',
      event_date: vehicle.created_at,
      title: `Listed for Sale on ${sourceName}`,
      description: vehicle.asking_price 
        ? `${vehicle.year} ${vehicle.make} ${vehicle.model} listed for $${vehicle.asking_price.toLocaleString()}`
        : `${vehicle.year} ${vehicle.make} ${vehicle.model} discovered on ${sourceName}`,
      source: sourceName,
      source_type: 'dealer_record',
      data_source: vehicle.discovery_url,
      confidence_score: 90,
      cost_amount: vehicle.asking_price || null,
      metadata: {
        origin: origin,
        listing_url: vehicle.discovery_url,
        asking_price: vehicle.asking_price
      }
    })
    if (success) eventsCreated++
  } else {
    // Manual entry - create profile created event
    const success = await createTimelineEvent({
      vehicle_id: vehicle.id,
      user_id: vehicle.uploaded_by,
      event_type: 'auction_listed', // Using auction_listed as it's a valid type
      event_date: vehicle.created_at,
      title: 'Vehicle Profile Created',
      description: `${vehicle.year} ${vehicle.make} ${vehicle.model} profile created via ${sourceName}`,
      source: sourceName,
      source_type: 'user_input',
      confidence_score: 100,
      metadata: {
        origin: origin,
        entry_type: 'profile_creation'
      }
    })
    if (success) eventsCreated++
  }
  
  // 2. Create photo events (group by date)
  if (images.length > 0) {
    // Group images by date
    const imagesByDate = {}
    images.forEach(img => {
      const date = img.created_at?.substring(0, 10) || 'unknown'
      if (!imagesByDate[date]) {
        imagesByDate[date] = []
      }
      imagesByDate[date].push(img)
    })
    
    // Create one event per date
    for (const [date, dateImages] of Object.entries(imagesByDate)) {
      const imageUrls = dateImages.map(i => i.image_url).slice(0, 20) // Limit URLs stored
      const imgSource = dateImages[0]?.source || 'user_upload'
      const imgSourceName = SOURCE_NAMES[imgSource] || imgSource
      
      const success = await createTimelineEvent({
        vehicle_id: vehicle.id,
        user_id: vehicle.uploaded_by,
        event_type: 'auction_listed', // Valid type
        event_date: dateImages[0]?.created_at || vehicle.created_at,
        title: `${dateImages.length} Photo${dateImages.length > 1 ? 's' : ''} Added`,
        description: `${dateImages.length} photo${dateImages.length > 1 ? 's' : ''} ${imgSource === 'user_upload' ? 'uploaded' : 'imported from ' + imgSourceName}`,
        source: imgSourceName,
        source_type: imgSource.includes('scrape') || imgSource.includes('import') ? 'dealer_record' : 'user_input',
        confidence_score: 95,
        image_urls: imageUrls,
        metadata: {
          photo_count: dateImages.length,
          source: imgSource,
          upload_date: date
        }
      })
      if (success) eventsCreated++
    }
  }
  
  console.log(`  Created ${eventsCreated} timeline events`)
  return eventsCreated
}

async function backfillFieldSources(vehicle) {
  if (!vehicle.discovery_url) return 0
  
  const origin = vehicle.profile_origin || vehicle.discovery_source || 'unknown'
  const sourceName = SOURCE_NAMES[origin] || origin
  
  // Check if field sources already exist
  const { data: existing } = await supabase
    .from('vehicle_field_sources')
    .select('id')
    .eq('vehicle_id', vehicle.id)
    .limit(1)
  
  if (existing?.length) return 0
  
  const fields = []
  if (vehicle.year) fields.push({ field_name: 'year', field_value: String(vehicle.year) })
  if (vehicle.make) fields.push({ field_name: 'make', field_value: vehicle.make })
  if (vehicle.model) fields.push({ field_name: 'model', field_value: vehicle.model })
  if (vehicle.asking_price) fields.push({ field_name: 'asking_price', field_value: String(vehicle.asking_price) })
  
  let created = 0
  for (const f of fields) {
    const { error } = await supabase.from('vehicle_field_sources').insert({
      vehicle_id: vehicle.id,
      field_name: f.field_name,
      field_value: f.field_value,
      source_type: 'ai_scraped',
      source_url: vehicle.discovery_url,
      confidence_score: 90,
      user_id: vehicle.uploaded_by,
      extraction_method: 'url_scraping',
      metadata: { source: sourceName, origin: origin }
    })
    if (!error) created++
  }
  
  return created
}

async function run() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Timeline Events Backfill')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  
  const vehicles = await getVehiclesWithoutTimeline()
  console.log(`\nFound ${vehicles.length} vehicles without timeline events\n`)
  
  if (vehicles.length === 0) {
    console.log('All vehicles have timeline events!')
    return
  }
  
  let totalEvents = 0
  let totalFieldSources = 0
  let processed = 0
  
  for (const vehicle of vehicles) {
    const events = await backfillVehicle(vehicle)
    const sources = await backfillFieldSources(vehicle)
    totalEvents += events
    totalFieldSources += sources
    processed++
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 100))
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`Backfill Complete!`)
  console.log(`  Vehicles processed: ${processed}`)
  console.log(`  Timeline events created: ${totalEvents}`)
  console.log(`  Field sources created: ${totalFieldSources}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

run().catch(console.error)

