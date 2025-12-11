import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractAndCacheFavicon } from '../_shared/extractFavicon.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { 
      batch_size = 15, // Process 15 listings per run (to avoid timeout)
      user_id = null // Optional: user_id for vehicle creation
    } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || `https://qkgaybvrernstplzjaam.supabase.co`
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''
    
    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    )

    // Get or find user_id for imports
    let importUserId = user_id
    
    if (!importUserId) {
      const { data: systemUser } = await supabase
        .from('profiles')
        .select('id')
        .or('email.eq.system@n-zero.dev,email.eq.admin@n-zero.dev')
        .limit(1)
        .maybeSingle()
      
      if (systemUser) {
        importUserId = systemUser.id
      } else {
        const { data: adminUser } = await supabase
          .from('profiles')
          .select('id')
          .eq('is_admin', true)
          .limit(1)
          .maybeSingle()
        
        if (adminUser) {
          importUserId = adminUser.id
        } else {
          const { data: firstUser } = await supabase
            .from('profiles')
            .select('id')
            .limit(1)
            .maybeSingle()
          
          if (firstUser) {
            importUserId = firstUser.id
          }
        }
      }
    }

    if (!importUserId) {
      return new Response(
        JSON.stringify({ success: false, error: 'No user_id found. Please provide user_id or ensure users exist.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log('🔄 Processing Craigslist queue...')
    console.log(`Using user_id: ${importUserId}`)

    // Get pending listings from queue
    const { data: queueItems, error: queueError } = await supabase
      .from('craigslist_listing_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(batch_size)

    if (queueError) {
      throw new Error(`Failed to fetch queue: ${queueError.message}`)
    }

    if (!queueItems || queueItems.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pending listings in queue',
          stats: { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    console.log(`📋 Processing ${queueItems.length} listings from queue...`)

    const stats = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    }

    // Process each listing
    for (const queueItem of queueItems) {
      try {
        // Mark as processing
        await supabase
          .from('craigslist_listing_queue')
          .update({ 
            status: 'processing',
            updated_at: new Date().toISOString()
          })
          .eq('id', queueItem.id)

        console.log(`\n🔍 Processing: ${queueItem.listing_url}`)

        // Scrape listing
        let scrapeData: any
        try {
          const response = await fetch(queueItem.listing_url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          })
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const html = await response.text()
          const doc = new DOMParser().parseFromString(html, 'text/html')
          
          if (!doc) {
            throw new Error('Failed to parse HTML')
          }
          
          scrapeData = {
            success: true,
            data: scrapeCraigslistInline(doc, queueItem.listing_url)
          }
          
        } catch (scrapeError: any) {
          // Mark as failed and increment retry count
          const newRetryCount = queueItem.retry_count + 1
          const shouldRetry = newRetryCount < queueItem.max_retries
          
          await supabase
            .from('craigslist_listing_queue')
            .update({
              status: shouldRetry ? 'pending' : 'failed',
              error_message: scrapeError.message,
              retry_count: newRetryCount,
              updated_at: new Date().toISOString()
            })
            .eq('id', queueItem.id)

          stats.failed++
          console.error(`  ❌ Scrape failed: ${scrapeError.message}`)
          continue
        }

        if (!scrapeData?.success || !scrapeData?.data) {
          await supabase
            .from('craigslist_listing_queue')
            .update({
              status: 'failed',
              error_message: 'No data returned from scrape',
              updated_at: new Date().toISOString()
            })
            .eq('id', queueItem.id)

          stats.failed++
          continue
        }

        // Extract and validate vehicle data
        const data = scrapeData.data
        let make = (data.make || '').toLowerCase()
        let model = (data.model || '').toLowerCase() || ''
        const yearNum = typeof data.year === 'string' ? parseInt(data.year) : data.year

        // Extract from title if missing
        if (!make || !model) {
          const title = (data.title || '').toLowerCase()
          if (title.includes('chevrolet') || title.includes('chevy')) {
            make = 'chevrolet'
          } else if (title.includes('gmc')) {
            make = 'gmc'
          }
          
          if (!model && make) {
            const modelPatterns = ['c10', 'c20', 'c30', 'k10', 'k20', 'k30', 'truck', 'pickup', 'suburban', 'blazer', 'jimmy']
            for (const pattern of modelPatterns) {
              if (title.includes(pattern)) {
                model = pattern === 'truck' || pattern === 'pickup' ? 'truck' : pattern
                break
              }
            }
          }
        }

        const finalMake = make || data.make || ''
        const finalModel = model || data.model || 'Unknown'

        // Filter for squarebodies (1973-1991 Chevy/GMC)
        const isSquarebody = 
          yearNum >= 1973 && yearNum <= 1991 &&
          (finalMake === 'chevrolet' || finalMake === 'gmc' || finalMake === 'chevy') &&
          (finalModel.includes('truck') || 
           finalModel.includes('pickup') ||
           finalModel.includes('suburban') ||
           finalModel.includes('blazer') ||
           finalModel.includes('jimmy') ||
           finalModel.includes('c10') ||
           finalModel.includes('c20') ||
           finalModel.includes('c30') ||
           finalModel.includes('k10') ||
           finalModel.includes('k20') ||
           finalModel.includes('k30') ||
           finalModel === 'c/k' ||
           (data.title || '').toLowerCase().includes('squarebody') ||
           (data.title || '').toLowerCase().includes('square body') ||
           (data.description || '').toLowerCase().includes('squarebody') ||
           (data.description || '').toLowerCase().includes('square body'))

        if (!isSquarebody) {
          await supabase
            .from('craigslist_listing_queue')
            .update({
              status: 'skipped',
              error_message: 'Not a squarebody (1973-1991 Chevy/GMC)',
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', queueItem.id)

          stats.skipped++
          console.log(`  ⏭️  Skipped: Not a squarebody`)
          continue
        }

        // Validate required fields
        if (!yearNum || isNaN(yearNum) || yearNum < 1973 || yearNum > 1991) {
          await supabase
            .from('craigslist_listing_queue')
            .update({
              status: 'failed',
              error_message: `Invalid year: ${yearNum}`,
              updated_at: new Date().toISOString()
            })
            .eq('id', queueItem.id)

          stats.failed++
          continue
        }

        if (!finalMake || finalMake.trim() === '') {
          await supabase
            .from('craigslist_listing_queue')
            .update({
              status: 'failed',
              error_message: `Missing make`,
              updated_at: new Date().toISOString()
            })
            .eq('id', queueItem.id)

          stats.failed++
          continue
        }

        // Find or create vehicle
        let vehicleId: string | null = null
        let isNew = false

        // Try to find by VIN
        if (data.vin) {
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('vin', data.vin)
            .maybeSingle()

          if (existing) {
            vehicleId = existing.id
            isNew = false
          }
        }

        // Try to find by year/make/model
        if (!vehicleId) {
          const { data: existing } = await supabase
            .from('vehicles')
            .select('id')
            .eq('year', yearNum)
            .ilike('make', finalMake)
            .ilike('model', finalModel)
            .maybeSingle()

          if (existing) {
            vehicleId = existing.id
            isNew = false
          }
        }

        // Create new vehicle if not found (REFITTED - minimal insert)
        if (!vehicleId) {
          const { data: newVehicle, error: vehicleError } = await supabase
            .from('vehicles')
            .insert({
              year: yearNum,
              make: finalMake.charAt(0).toUpperCase() + finalMake.slice(1),
              model: finalModel,
              discovery_source: 'craigslist_scrape',
              discovery_url: queueItem.listing_url,
              profile_origin: 'craigslist_scrape',
              origin_metadata: {
                listing_url: queueItem.listing_url,
                imported_at: new Date().toISOString()
              },
              notes: data.description || null,
              is_public: true,
              status: 'active',
              uploaded_by: importUserId
            })
            .select('id')
            .single()

          if (vehicleError) {
            await supabase
              .from('craigslist_listing_queue')
              .update({
                status: 'failed',
                error_message: `Vehicle insert error: ${vehicleError.message}`,
                retry_count: queueItem.retry_count + 1,
                updated_at: new Date().toISOString()
              })
              .eq('id', queueItem.id)

            stats.failed++
            console.error(`  ❌ Vehicle insert error: ${vehicleError.message}`)
            continue
          }

          if (newVehicle?.id) {
            vehicleId = newVehicle.id
            isNew = true
            stats.created++

            // FORENSIC ENRICHMENT (replaces manual field assignment)
            await supabase.rpc('process_scraped_data_forensically', {
              p_vehicle_id: vehicleId,
              p_scraped_data: data,
              p_source_url: queueItem.listing_url,
              p_scraper_name: 'craigslist-queue',
              p_context: { description: data.description }
            })

            // Build consensus for all fields
            const fields = ['vin', 'color', 'mileage', 'transmission', 'drivetrain', 'engine_size', 'trim', 'series']
            for (const field of fields) {
              if (data[field]) {
                await supabase.rpc('build_field_consensus', {
                  p_vehicle_id: vehicleId,
                  p_field_name: field,
                  p_auto_assign: true
                })
              }
            }

            // Extract and cache favicon for this source (non-blocking)
            extractAndCacheFavicon(
              supabase,
              queueItem.listing_url,
              'classified',
              'Craigslist'
            ).catch(err => {
              console.warn('Failed to cache favicon (non-critical):', err)
            })

            // Create timeline event
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:394',message:'Before timeline event creation',data:{hasPostedDate:!!data.posted_date,posted_date:data.posted_date},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            
            if (data.posted_date) {
              try {
                let eventDate = new Date().toISOString().split('T')[0]
                const dateMatch = data.posted_date.match(/(\d{4})-(\d{2})-(\d{2})/)
                if (dateMatch) {
                  eventDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
                }
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:402',message:'Timeline event date calculated',data:{originalPostedDate:data.posted_date,eventDate},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion

                await supabase
                  .from('timeline_events')
                  .insert({
                    vehicle_id: vehicleId,
                    user_id: importUserId,
                    event_type: 'discovery',
                    source: 'craigslist',
                    title: `Listed on Craigslist`,
                    event_date: eventDate,
                    description: `Vehicle listed for sale on Craigslist${data.asking_price ? ` for $${data.asking_price.toLocaleString()}` : ''}`,
                    metadata: {
                      listing_url: queueItem.listing_url,
                      asking_price: data.asking_price || data.price,
                      location: data.location,
                      posted_date: data.posted_date
                    }
                  })
                  
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:422',message:'Timeline event created',data:{eventDate},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
              } catch (timelineErr) {
                console.warn(`  ⚠️ Timeline event creation error:`, timelineErr)
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:425',message:'Timeline event creation error',data:{error:timelineErr?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
              }
            } else {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:430',message:'No posted_date - timeline event skipped',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
            }

            // Download and upload images
            if (data.images && data.images.length > 0) {
              console.log(`  📸 Downloading ${data.images.length} images...`)
              let imagesUploaded = 0
              
              for (let i = 0; i < data.images.length; i++) {
                const imageUrl = data.images[i]
                try {
                  const imageResponse = await fetch(imageUrl, {
                    signal: AbortSignal.timeout(10000)
                  })
                  
                  if (!imageResponse.ok) continue
                  
                  const imageBlob = await imageResponse.blob()
                  const arrayBuffer = await imageBlob.arrayBuffer()
                  const uint8Array = new Uint8Array(arrayBuffer)
                  
                  const ext = imageUrl.match(/\.(jpg|jpeg|png|webp)$/i)?.[1] || 'jpg'
                  const fileName = `${Date.now()}_${i}.${ext}`
                  const storagePath = `${vehicleId}/${fileName}`
                  
                  const { error: uploadError } = await supabase.storage
                    .from('vehicle-images')
                    .upload(storagePath, uint8Array, {
                      contentType: `image/${ext}`,
                      cacheControl: '3600',
                      upsert: false
                    })
                  
                  if (uploadError) continue
                  
                  const { data: { publicUrl } } = supabase.storage
                    .from('vehicle-images')
                    .getPublicUrl(storagePath)
                  
                  // Create ghost user for photographer
                  const photographerFingerprint = `CL-Photographer-${queueItem.listing_url}`
                  let ghostUserId: string | null = null
                  
                  const { data: existingGhost } = await supabase
                    .from('ghost_users')
                    .select('id')
                    .eq('device_fingerprint', photographerFingerprint)
                    .maybeSingle()
                  
                  if (existingGhost?.id) {
                    ghostUserId = existingGhost.id
                  } else {
                    const { data: newGhost } = await supabase
                      .from('ghost_users')
                      .insert({
                        device_fingerprint: photographerFingerprint,
                        camera_make: 'Unknown',
                        camera_model: 'Craigslist Listing',
                        display_name: `Craigslist Photographer`,
                        total_contributions: 0
                      })
                      .select('id')
                      .single()
                    
                    if (newGhost?.id) {
                      ghostUserId = newGhost.id
                    }
                  }

                  const { data: imageData, error: imageInsertError } = await supabase
                    .from('vehicle_images')
                    .insert({
                      vehicle_id: vehicleId,
                      image_url: publicUrl,
                      user_id: ghostUserId || importUserId,
                      is_primary: i === 0,
                      source: 'craigslist_scrape',
                      taken_at: data.posted_date || new Date().toISOString(),
                      exif_data: {
                        source_url: imageUrl,
                        discovery_url: queueItem.listing_url,
                        imported_by_user_id: importUserId,
                        imported_at: new Date().toISOString(),
                        attribution_note: 'Photographer unknown - images from Craigslist listing. Original photographer can claim with proof.',
                        claimable: true,
                        device_fingerprint: photographerFingerprint
                      }
                    })
                    .select('id')
                    .single()
                  
                  if (imageInsertError) {
                    console.warn(`    ⚠️ Failed to create image record ${i + 1}: ${imageInsertError.message}`)
                    continue
                  }
                  
                  // Create device attribution if ghost user exists
                  if (ghostUserId && imageData?.id) {
                    await supabase
                      .from('device_attributions')
                      .insert({
                        image_id: imageData.id,
                        device_fingerprint: photographerFingerprint,
                        ghost_user_id: ghostUserId,
                        uploaded_by_user_id: importUserId,
                        attribution_source: 'craigslist_listing_unknown_photographer',
                        confidence_score: 50
                      })
                  }
                  
                  imagesUploaded++
                  await new Promise(resolve => setTimeout(resolve, 500))
                  
                } catch (imgError) {
                  console.warn(`    ⚠️ Error processing image ${i + 1}:`, imgError)
                }
              }
              
              console.log(`  📸 Uploaded ${imagesUploaded} images`)
            }
          }
        } else {
          // Update existing vehicle
          await supabase
            .from('vehicles')
            .update({
              asking_price: data.asking_price || data.price || null,
              mileage: data.mileage || null
            })
            .eq('id', vehicleId)

          stats.updated++
        }

        // Mark as complete
        await supabase
          .from('craigslist_listing_queue')
          .update({
            status: 'complete',
            vehicle_id: vehicleId,
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', queueItem.id)

        stats.processed++
        console.log(`  ✅ Complete: ${yearNum} ${finalMake} ${finalModel}`)

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500))

      } catch (error: any) {
        console.error(`  ❌ Error processing ${queueItem.listing_url}:`, error)
        
        const newRetryCount = queueItem.retry_count + 1
        const shouldRetry = newRetryCount < queueItem.max_retries

        await supabase
          .from('craigslist_listing_queue')
          .update({
            status: shouldRetry ? 'pending' : 'failed',
            error_message: error.message,
            retry_count: newRetryCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', queueItem.id)

        stats.failed++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats,
        message: `Processed ${stats.processed} listings: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.failed} failed`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Error in process-cl-queue:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

// Inline Craigslist scraping function (same as scrape-all-craigslist-squarebodies)
function scrapeCraigslistInline(doc: any, url: string): any {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:611',message:'scrapeCraigslistInline entry',data:{url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  const data: any = {
    source: 'Craigslist',
    listing_url: url
  }

  const titleElement = doc.querySelector('h1, .postingtitletext #titletextonly')
  if (titleElement) {
    data.title = titleElement.textContent.trim()
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:620',message:'Title extracted',data:{title:data.title},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) data.year = yearMatch[0]
    
    const vehicleMatch = data.title.match(/\b(19|20)\d{2}\s+([A-Za-z]+)\s+(.+?)(?:\s*-\s*\$|\s*\$|\(|$)/i)
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:625',message:'Vehicle regex match result',data:{matched:!!vehicleMatch,make:vehicleMatch?.[2],model:vehicleMatch?.[3]},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    if (vehicleMatch && vehicleMatch[3]) {
      data.make = vehicleMatch[2]
      let modelText = vehicleMatch[3].trim()
      modelText = modelText.replace(/\s*\([^)]+\)\s*$/, '')
      modelText = modelText.replace(/\s+(4x4|4wd|2wd|diesel|gas|automatic|manual)\s*$/i, '').trim()
      if (modelText) {
        data.model = modelText
      }
    }
    
    if (!data.model && data.make) {
      const afterMake = data.title.replace(new RegExp(`\\b(19|20)\\d{2}\\s+${data.make}\\s+`, 'i'), '')
      const modelPart = afterMake.split(/\s*-\s*\$|\s*\$|\(/)[0].trim()
      if (modelPart && modelPart.length > 0) {
        data.model = modelPart
      }
    }
    
    const priceMatch = data.title.match(/\$\s*([\d,]+)/)
    if (priceMatch) data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
    
    const locationMatch = data.title.match(/\(([^)]+)\)\s*$/i)
    if (locationMatch) data.location = locationMatch[1].trim()
  }

  const fullText = doc.body?.textContent || ''
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:652',message:'Before posted_date extraction',data:{hasPostedDate:!!data.posted_date},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // Extract posted date from HTML
  // Try multiple selectors for posted date
  const postedDateSelectors = [
    'time.date',
    '.postinginfos time',
    'time[datetime]',
    '.postinginfo time',
    'span[class*="date"]',
    '.postingtitletext time'
  ]
  
  let postedDateFound = false
  for (const selector of postedDateSelectors) {
    const dateElement = doc.querySelector(selector)
    if (dateElement) {
      const datetime = dateElement.getAttribute('datetime') || dateElement.textContent?.trim()
      if (datetime) {
        try {
          const parsedDate = new Date(datetime)
          if (!isNaN(parsedDate.getTime())) {
            data.posted_date = parsedDate.toISOString()
            postedDateFound = true
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:675',message:'Posted date extracted from selector',data:{selector,posted_date:data.posted_date},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            break
          }
        } catch (e) {
          // Continue to next selector
        }
      }
    }
  }
  
  // Fallback: try to extract from text content (e.g., "Posted 2025-11-27 15:00")
  if (!postedDateFound) {
    const postedTextMatch = fullText.match(/Posted\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/i)
    if (postedTextMatch) {
      const [, year, month, day, hour, minute] = postedTextMatch
      const dateStr = `${year}-${month}-${day}T${hour}:${minute}:00`
      try {
        const parsedDate = new Date(dateStr)
        if (!isNaN(parsedDate.getTime())) {
          data.posted_date = parsedDate.toISOString()
          postedDateFound = true
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:695',message:'Posted date extracted from text pattern',data:{posted_date:data.posted_date},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
        }
      } catch (e) {
        // Continue
      }
    }
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:702',message:'After posted_date extraction',data:{hasPostedDate:!!data.posted_date,posted_date:data.posted_date},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  const attrGroups = doc.querySelectorAll('.attrgroup')
  attrGroups.forEach((group: any) => {
    const spans = group.querySelectorAll('span')
    spans.forEach((span: any) => {
      const text = span.textContent.trim()
      if (text.includes('condition:')) data.condition = text.replace('condition:', '').trim()
      else if (text.includes('cylinders:')) {
        const cylMatch = text.match(/(\d+)\s+cylinders/)
        if (cylMatch) data.cylinders = parseInt(cylMatch[1])
      }
      else if (text.includes('drive:')) data.drivetrain = text.replace('drive:', '').trim()
      else if (text.includes('fuel:')) data.fuel_type = text.replace('fuel:', '').trim()
      else if (text.includes('odometer:')) {
        const odoMatch = text.match(/odometer:\s*([\d,]+)/)
        if (odoMatch) data.mileage = parseInt(odoMatch[1].replace(/,/g, ''))
      }
      else if (text.includes('paint color:')) data.color = text.replace('paint color:', '').trim()
      else if (text.includes('title status:')) data.title_status = text.replace('title status:', '').trim()
      else if (text.includes('transmission:')) data.transmission = text.replace('transmission:', '').trim()
      else if (text.includes('type:')) data.body_style = text.replace('type:', '').trim()
    })
  })
  
  const descElement = doc.querySelector('#postingbody')
  if (descElement) {
    data.description = descElement.textContent.trim().substring(0, 5000)
  }

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:730',message:'Before image extraction',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  const images: string[] = []
  const thumbLinks = doc.querySelectorAll('a.thumb')
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:735',message:'Thumb links found',data:{thumbCount:thumbLinks.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  thumbLinks.forEach((link: any) => {
    const href = link.getAttribute('href')
    if (href && href.startsWith('http')) {
      images.push(href.replace(/\/\d+x\d+\//, '/1200x900/'))
    }
  })
  
  // Also try extracting from img tags with images.craigslist.org URLs
  const imgTags = doc.querySelectorAll('img[src*="images.craigslist.org"]')
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:747',message:'Img tags found',data:{imgTagCount:imgTags.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  imgTags.forEach((img: any) => {
    const src = img.getAttribute('src')
    if (src && src.includes('images.craigslist.org') && !images.includes(src)) {
      // Upgrade to high-res version
      const highResUrl = src.replace(/\/\d+x\d+\//, '/1200x900/').replace(/\/50x50c\//, '/1200x900/')
      if (!images.includes(highResUrl)) {
        images.push(highResUrl)
      }
    }
  })
  
  // Also try data-src attributes (lazy loading)
  const lazyImages = doc.querySelectorAll('img[data-src*="images.craigslist.org"]')
  lazyImages.forEach((img: any) => {
    const dataSrc = img.getAttribute('data-src')
    if (dataSrc && dataSrc.includes('images.craigslist.org')) {
      const highResUrl = dataSrc.replace(/\/\d+x\d+\//, '/1200x900/').replace(/\/50x50c\//, '/1200x900/')
      if (!images.includes(highResUrl)) {
        images.push(highResUrl)
      }
    }
  })
  
  if (images.length > 0) {
    data.images = Array.from(new Set(images)).slice(0, 50)
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:770',message:'After image extraction',data:{imageCount:data.images?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
  // #endregion

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'process-cl-queue/index.ts:774',message:'scrapeCraigslistInline exit',data:{title:data.title,year:data.year,make:data.make,model:data.model,posted_date:data.posted_date,imageCount:data.images?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'ALL'})}).catch(()=>{});
  // #endregion

  return data
}

