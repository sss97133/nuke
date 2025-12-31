import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import exifr from 'npm:exifr@7.1.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STORAGE_BUCKET = 'vehicle-data'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { vehicle_id, limit = 20 } = await req.json()

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://qkgaybvrernstplzjaam.supabase.co'
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    let vehicles: any[] = []

    if (vehicle_id) {
      // If specific vehicle requested, get just that one
      const { data: singleVehicle, error: singleError } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          discovery_url,
          uploaded_by,
          origin_metadata
        `)
        .eq('id', vehicle_id)
        .single()

      if (singleError) {
        throw new Error(`Failed to fetch vehicle: ${singleError.message}`)
      }

      if (!singleVehicle) {
        return new Response(
          JSON.stringify({ success: false, error: 'Vehicle not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }

      // Check if it has images
      const { data: existingImages, error: imagesError } = await supabase
        .from('vehicle_images')
        .select('id')
        .eq('vehicle_id', vehicle_id)
        .limit(1)

      console.log(`Checking images for vehicle ${vehicle_id}:`, { existingImages, imagesError, count: existingImages?.length || 0 })

      if (existingImages && existingImages.length > 0) {
        console.log(`Vehicle ${vehicle_id} already has ${existingImages.length} images`)
        return new Response(
          JSON.stringify({ success: true, message: 'Vehicle already has images', processed: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log(`Vehicle ${vehicle_id} has no images, proceeding with backfill`)
      vehicles = [singleVehicle]
    } else {
      // Get all Craigslist vehicles first
      const { data: allVehicles, error: allVehiclesError } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_source', 'craigslist_scrape')
        .limit(limit * 2) // Get more to filter

      if (allVehiclesError) {
        throw new Error(`Failed to fetch vehicles: ${allVehiclesError.message}`)
      }

      if (!allVehicles || allVehicles.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'No Craigslist vehicles found', processed: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check which vehicles don't have images
      const vehicleIds = allVehicles.map(v => v.id)
      const { data: vehiclesWithImages } = await supabase
        .from('vehicle_images')
        .select('vehicle_id')
        .in('vehicle_id', vehicleIds)

      const vehiclesWithImageIds = new Set((vehiclesWithImages || []).map(img => img.vehicle_id))
      const vehiclesWithoutImages = vehicleIds.filter(id => !vehiclesWithImageIds.has(id))

      if (vehiclesWithoutImages.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'All vehicles already have images', processed: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get full vehicle data for vehicles without images (including origin_metadata)
      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          discovery_url,
          uploaded_by,
          origin_metadata
        `)
        .in('id', vehiclesWithoutImages.slice(0, limit))

      if (vehiclesError) {
        throw new Error(`Failed to fetch vehicles: ${vehiclesError.message}`)
      }

      if (!vehiclesData || vehiclesData.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'No vehicles need image backfill', processed: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      vehicles = vehiclesData
    }

    console.log(`Found ${vehicles.length} vehicles without images`)
    if (vehicles.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No vehicles to process', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let processed = 0
    let imagesAdded = 0
    const errors: any[] = []

    for (const vehicle of vehicles) {
      console.log(`\n=== Processing vehicle ${vehicle.id} ===`)
      if (!vehicle.discovery_url) {
        console.log(`⏭️  Skipping ${vehicle.year} ${vehicle.make} ${vehicle.model} - no discovery_url`)
        continue
      }

      try {
        console.log(`\n📸 Processing: ${vehicle.year} ${vehicle.make} ${vehicle.model}`)
        console.log(`   URL: ${vehicle.discovery_url}`)

        // First, check if we have cached image URLs in origin_metadata
        let images: string[] = []
        const originMeta = vehicle.origin_metadata || {}
        if (originMeta.image_urls && Array.isArray(originMeta.image_urls) && originMeta.image_urls.length > 0) {
          console.log(`   ✅ Found ${originMeta.image_urls.length} cached image URLs in origin_metadata`)
          images = originMeta.image_urls.slice(0, 20)
        } else {
          // Try to fetch from listing if no cached URLs
          console.log(`   📡 Fetching from listing (no cached URLs)...`)
          
          // Use scrape-vehicle function to extract images (most reliable)
          try {
            // Call scrape-vehicle via HTTP (functions.invoke may have auth issues)
            const scrapeUrl = `${supabaseUrl}/functions/v1/scrape-vehicle`
            const scrapeResponse = await fetch(scrapeUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ url: vehicle.discovery_url })
            })

            if (!scrapeResponse.ok) {
              throw new Error(`scrape-vehicle returned ${scrapeResponse.status}`)
            }

            const scrapeData = await scrapeResponse.json()

            if (scrapeData && scrapeData.success && scrapeData.data) {
              const scrapedData = scrapeData.data
              if (scrapedData.images && Array.isArray(scrapedData.images) && scrapedData.images.length > 0) {
                images.push(...scrapedData.images.slice(0, 20))
                console.log(`   ✅ Found ${images.length} images via scrape-vehicle function`)
              } else {
                console.log(`   ⚠️  scrape-vehicle returned no images`)
                console.log(`   Scrape data:`, JSON.stringify(scrapedData).substring(0, 200))
              }
            } else {
              console.log(`   ⚠️  scrape-vehicle failed, trying direct extraction...`)
              console.log(`   Response:`, JSON.stringify(scrapeData).substring(0, 200))
              
              // Fallback: direct extraction
              const listingResponse = await fetch(vehicle.discovery_url, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                signal: AbortSignal.timeout(15000)
              })

              if (!listingResponse.ok) {
                throw new Error(`HTTP ${listingResponse.status}`)
              }

              const html = await listingResponse.text()
              const doc = new DOMParser().parseFromString(html, 'text/html')

              if (!doc) {
                throw new Error('Failed to parse HTML')
              }

              // Simple extraction (same as inline scraper)
              const thumbLinks = doc.querySelectorAll('a.thumb')
              console.log(`   Found ${thumbLinks.length} thumbnail links`)
              thumbLinks.forEach((link: any) => {
                const href = link.getAttribute('href')
                if (href && href.startsWith('http')) {
                  const fullSizeUrl = href.replace(/\/\d+x\d+\//, '/1200x900/')
                  if (!images.includes(fullSizeUrl)) {
                    images.push(fullSizeUrl)
                  }
                }
              })
              
              console.log(`   Found ${images.length} images via direct extraction`)
            }
          } catch (scrapeError: any) {
            console.error(`   ❌ Error calling scrape-vehicle: ${scrapeError.message}`)
            // Continue with empty images array - will skip this vehicle
          }
        }

        if (images.length === 0) {
          console.log(`   ⚠️  No images available (listing expired or no cached URLs)`)
          continue
        }

        console.log(`   Processing ${images.length} images`)

        // Download and upload ALL images (no limit)
        let uploaded = 0
        for (let i = 0; i < images.length; i++) {
          const imageUrl = images[i]
          
          try {
            // Download image
            const imageResponse = await fetch(imageUrl, {
              signal: AbortSignal.timeout(10000)
            })

            if (!imageResponse.ok) {
              console.warn(`    ⚠️ Failed to download image ${i + 1}: HTTP ${imageResponse.status}`)
              continue
            }

            const imageBlob = await imageResponse.blob()
            const arrayBuffer = await imageBlob.arrayBuffer()
            const uint8Array = new Uint8Array(arrayBuffer)

            // Extract EXIF data if available
            let exifData: any = null
            let takenAt: string | null = null
            let gpsLatitude: number | null = null
            let gpsLongitude: number | null = null
            
            try {
              exifData = await exifr.parse(arrayBuffer, {
                gps: true,
                pick: [
                  'DateTimeOriginal', 'DateTime', 'CreateDate', 'ModifyDate',
                  'GPSLatitude', 'GPSLongitude', 'latitude', 'longitude',
                  'GPSLatitudeRef', 'GPSLongitudeRef',
                  'Make', 'Model', 'ImageWidth', 'ImageHeight',
                  'ISO', 'FNumber', 'ExposureTime', 'FocalLength'
                ]
              })

              if (exifData) {
                // Extract date taken
                takenAt = exifData.DateTimeOriginal || exifData.DateTime || exifData.CreateDate || null
                
                // Extract GPS coordinates
                let lat = exifData.latitude || exifData.GPSLatitude
                let lon = exifData.longitude || exifData.GPSLongitude
                
                // Handle GPS reference directions
                if (exifData.GPSLatitudeRef === 'S' && lat > 0) lat = -lat
                if (exifData.GPSLongitudeRef === 'W' && lon > 0) lon = -lon
                
                if (lat && lon && typeof lat === 'number' && typeof lon === 'number') {
                  gpsLatitude = lat
                  gpsLongitude = lon
                }
              }
            } catch (exifError: any) {
              console.log(`    ⚠️ EXIF extraction failed for image ${i + 1}:`, exifError.message)
              // Continue without EXIF data
            }

            // Generate filename
            const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg'
            const fileName = `${Date.now()}_${i}.${ext}`
            const storagePath = `vehicles/${vehicle.id}/images/craigslist_scrape/${fileName}`

            // Upload to Supabase Storage
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from(STORAGE_BUCKET)
              .upload(storagePath, uint8Array, {
                contentType: `image/${ext}`,
                cacheControl: '3600',
                upsert: false
              })

            if (uploadError) {
              console.error(`    ❌ Upload error for image ${i + 1}:`, JSON.stringify(uploadError))
              continue
            }
            
            console.log(`    ✅ Uploaded to storage: ${storagePath}`)

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
              .from(STORAGE_BUCKET)
              .getPublicUrl(storagePath)

            // Create vehicle_images record with EXIF data
            const imageMetadata: any = {
              original_url: imageUrl,
              discovery_url: vehicle.discovery_url,
              backfilled: true,
              backfilled_at: new Date().toISOString()
            }

            if (exifData) {
              imageMetadata.exif = {
                date_taken: takenAt,
                camera: exifData.Make || exifData.Model ? {
                  make: exifData.Make || null,
                  model: exifData.Model || null
                } : null,
                gps: gpsLatitude && gpsLongitude ? {
                  latitude: gpsLatitude,
                  longitude: gpsLongitude
                } : null,
                technical: exifData.ISO || exifData.FNumber ? {
                  iso: exifData.ISO || null,
                  aperture: exifData.FNumber ? `f/${exifData.FNumber}` : null,
                  shutter_speed: exifData.ExposureTime || null,
                  focal_length: exifData.FocalLength ? `${exifData.FocalLength}mm` : null
                } : null
              }
            }

            const { error: imageInsertError } = await supabase
              .from('vehicle_images')
              .insert({
                vehicle_id: vehicle.id,
                image_url: publicUrl,
                uploaded_by: vehicle.uploaded_by,
                is_primary: i === 0, // First image is primary
                source: 'craigslist_scrape',
                taken_at: takenAt || null,
                gps_latitude: gpsLatitude,
                gps_longitude: gpsLongitude,
                metadata: imageMetadata
              })

            if (imageInsertError) {
              console.error(`    ❌ DB insert error for image ${i + 1}:`, JSON.stringify(imageInsertError))
              continue
            }
            
            console.log(`    ✅ Created vehicle_images record for image ${i + 1}`)

            uploaded++
            imagesAdded++
            console.log(`    ✅ Uploaded image ${uploaded}/${images.length}`)

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 500))

          } catch (imgError: any) {
            console.error(`    ❌ Error processing image ${i + 1}:`, imgError.message, imgError.stack)
            continue
          }
        }

        processed++
        console.log(`   ✅ Added ${uploaded} images to vehicle ${vehicle.id}`)

      } catch (error: any) {
        const errorObj = {
          vehicle_id: vehicle.id,
          vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          error: error.message
        }
        console.error(`   ❌ Error: ${error.message}`)
        errors.push(errorObj)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        imagesAdded,
        errors: errors.slice(0, 10), // Return first 10 errors
        message: `Processed ${processed} vehicles, added ${imagesAdded} images`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Backfill error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

