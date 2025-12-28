import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractAndCacheFavicon } from '../_shared/extractFavicon.ts'
import { normalizeListingLocation } from '../_shared/normalizeListingLocation.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 200 })
  }

  try {
    const { 
      batch_size = 20, // Reduced from 50 to avoid timeouts (image processing is slow)
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

    const coalesceString = (...vals: any[]) => {
      for (const v of vals) {
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return null
    }

    const safeIso = (v: any): string | null => {
      if (!v) return null
      try {
        const d = new Date(String(v))
        if (Number.isNaN(d.getTime())) return null
        return d.toISOString()
      } catch {
        return null
      }
    }

    const extractVinFromText = (text: string | null | undefined): string | null => {
      const s = (text || '').toUpperCase()
      // Strict VIN charset (no I/O/Q)
      const m = s.match(/\b([A-HJ-NPR-Z0-9]{17})\b/)
      return m?.[1] || null
    }

    const extractProvenanceSnippets = (text: string | null | undefined): string[] => {
      const s = (text || '').replace(/\s+/g, ' ').trim()
      if (!s) return []
      const out: string[] = []
      const patterns: RegExp[] = [
        /\bsecond owner\b[^.]{0,180}\./i,
        /\bthird owner\b[^.]{0,180}\./i,
        /\bowned\b[^.]{0,180}\b(since|for)\b[^.]{0,80}\./i,
        /\b(purchased|bought)\b[^.]{0,80}\bnew\b[^.]{0,80}\./i,
        /\buncle\b[^.]{0,180}\./i,
      ]
      for (const re of patterns) {
        const m = s.match(re)
        if (m?.[0]) out.push(m[0].trim())
      }
      return Array.from(new Set(out.map((x) => x.trim()))).filter(Boolean).slice(0, 5)
    }

    const writeExtractionMetadata = async (args: {
      vehicle_id: string
      source_url: string
      extraction_method: string
      scraper_version: string
      scraped_data: any
      fields: Array<{ field_name: string; field_value: string | null; confidence?: number }>
    }) => {
      const rows = (args.fields || [])
        .filter((f) => f.field_name && (f.field_value ?? '') !== '')
        .map((f) => ({
          vehicle_id: args.vehicle_id,
          field_name: f.field_name,
          field_value: f.field_value,
          extraction_method: args.extraction_method,
          scraper_version: args.scraper_version,
          source_url: args.source_url,
          confidence_score: typeof f.confidence === 'number' ? f.confidence : 0.8,
          raw_extraction_data: args.scraped_data ?? null,
        }))
      if (rows.length === 0) return
      try {
        await supabase.from('extraction_metadata').insert(rows)
      } catch (e) {
        console.warn('extraction_metadata insert failed (non-fatal):', (e as any)?.message || e)
      }
    }

    const upsertExternalListing = async (args: {
      vehicle_id: string
      listing_url: string
      listing_status: string
      metadata: any
    }) => {
      if (!args.listing_url) return
      try {
        const url = String(args.listing_url)
        const listingId =
          url.match(/\/(\d+)\.html(?:$|\?)/)?.[1] ||
          url.match(/[?&]postingID=(\d+)/i)?.[1] ||
          null

        await supabase
          .from('external_listings')
          .upsert(
            {
              vehicle_id: args.vehicle_id,
              organization_id: null,
              platform: 'craigslist',
              listing_url: args.listing_url,
              listing_id: listingId,
              listing_status: args.listing_status,
              metadata: args.metadata ?? {},
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: 'vehicle_id,platform,listing_id' }
          )
      } catch (e) {
        console.warn('external_listings upsert failed (non-fatal):', (e as any)?.message || e)
      }
    }

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

    // Track execution time to avoid timeout (Edge Functions have 60s limit, or 400s on paid plans)
    const startTime = Date.now()
    const maxExecutionTime = 50000 // 50 seconds - leave 10s buffer for response
    const skipImageProcessingAfter = 40000 // Skip images after 40s to save time

    // PARALLEL PROCESSING: Process listings in batches of 5 for 5x throughput
    const CONCURRENCY_LIMIT = 5
    
    // Helper function to process a single queue item (returns stats delta)
    const processQueueItem = async (queueItem: any): Promise<{ 
      status: 'created' | 'updated' | 'skipped' | 'failed',
      vehicleId?: string 
    }> => {
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
          console.log(`[DEBUG] Fetching listing: ${queueItem.listing_url}`)
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
          
          // Log HTML structure for debugging
          const timeElements = doc.querySelectorAll('time')
          console.log(`[DEBUG] Found ${timeElements.length} time elements in HTML`)
          timeElements.forEach((time, i) => {
            console.log(`[DEBUG] Time element ${i}:`, {
              datetime: time.getAttribute('datetime'),
              text: time.textContent?.trim(),
              className: time.className
            })
          })
          
          scrapeData = {
            success: true,
            data: scrapeCraigslistInline(doc, queueItem.listing_url)
          }
          
          console.log(`[DEBUG] Scrape result:`, {
            title: scrapeData.data?.title,
            year: scrapeData.data?.year,
            make: scrapeData.data?.make,
            model: scrapeData.data?.model,
            posted_date: scrapeData.data?.posted_date,
            imageCount: scrapeData.data?.images?.length || 0
          })
          
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

          console.error(`  ❌ Scrape failed: ${scrapeError.message}`)
          return { status: 'failed' }
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

          return { status: 'failed' }
        }

        // Extract and validate vehicle data
        const data = scrapeData.data
        console.log(`[DEBUG] Raw extracted data:`, JSON.stringify(data, null, 2))

        // Canonical listing timestamps (for accurate listing age in UI).
        // Keep legacy `posted_date` for downstream code, but also populate `listing_posted_at` / `listing_updated_at`.
        const postedIso = safeIso((data as any)?.listing_posted_at || (data as any)?.posted_date)
        const updatedIso = safeIso((data as any)?.listing_updated_at || (data as any)?.updated_date)
        ;(data as any).listing_posted_at = postedIso
        ;(data as any).listing_updated_at = updatedIso

        // Normalize raw description text + fallback VIN/provenance extraction.
        const rawDesc = coalesceString((data as any)?.description, (data as any)?.raw_description, (data as any)?.posting_body)
        if (!(data as any)?.vin) {
          const vinFromText = extractVinFromText(rawDesc)
          if (vinFromText) (data as any).vin = vinFromText
        }
        
        let make = (data.make || '').toLowerCase()
        let model = (data.model || '').toLowerCase() || ''
        const yearNum = typeof data.year === 'string' ? parseInt(data.year) : data.year
        
        console.log(`[DEBUG] After normalization:`, { make, model, year: yearNum, posted_date: data.posted_date })

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

        // Only use extracted data - don't fill with defaults
        const finalMake = make || data.make || null
        const finalModel = model || data.model || null

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

          console.log(`  ⏭️  Skipped: Not a squarebody`)
          return { status: 'skipped' }
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

          return { status: 'failed' }
        }

        // Validate required fields - but don't fail if optional fields are missing
        // Only fail if critical fields are missing (year is required, make/model can be null)
        if (!yearNum || isNaN(yearNum)) {
          await supabase
            .from('craigslist_listing_queue')
            .update({
              status: 'failed',
              error_message: `Missing or invalid year`,
              updated_at: new Date().toISOString()
            })
            .eq('id', queueItem.id)

          return { status: 'failed' }
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

        // Try to find by year/make/model (only if we have make and model)
        if (!vehicleId && finalMake && finalModel) {
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
          const loc = normalizeListingLocation((data as any)?.location || null)
          const { data: newVehicle, error: vehicleError } = await supabase
            .from('vehicles')
            .insert({
              year: yearNum,
              make: finalMake ? (finalMake.charAt(0).toUpperCase() + finalMake.slice(1)) : null,
              model: finalModel || null,
              asking_price: (data as any)?.asking_price || (data as any)?.price || null,
              description: rawDesc || null,
              discovery_source: 'craigslist_scrape',
              discovery_url: queueItem.listing_url,
              listing_source: 'craigslist',
              listing_url: queueItem.listing_url,
              listing_posted_at: (data as any)?.listing_posted_at || null,
              listing_updated_at: (data as any)?.listing_updated_at || null,
              listing_title: (data as any)?.title || null,
              listing_location: loc.clean,
              listing_location_raw: loc.raw,
              listing_location_observed_at: (data as any)?.listing_posted_at || (data as any)?.listing_updated_at || new Date().toISOString(),
              listing_location_source: 'craigslist',
              listing_location_confidence: loc.clean ? 0.7 : null,
              profile_origin: 'craigslist_scrape',
              origin_metadata: {
                listing_url: queueItem.listing_url,
                imported_at: new Date().toISOString(),
                listing_title: (data as any)?.title || null,
                listing_location: loc.clean,
                listing_posted_at: (data as any)?.listing_posted_at || null,
                listing_updated_at: (data as any)?.listing_updated_at || null,
                raw_description: rawDesc || null,
                scraper: 'craigslist-queue',
                scraper_version: 'v1'
              },
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

            console.error(`  ❌ Vehicle insert error: ${vehicleError.message}`)
            return { status: 'failed' }
          }

          if (newVehicle?.id) {
            vehicleId = newVehicle.id
            isNew = true

            // Persist extraction provenance for the listing (raw + parsed fields).
            const provenanceSnippets = extractProvenanceSnippets(rawDesc)
            await writeExtractionMetadata({
              vehicle_id: vehicleId,
              source_url: queueItem.listing_url,
              extraction_method: 'craigslist_scraper',
              scraper_version: 'v1',
              scraped_data: data,
              fields: [
                { field_name: 'listing_title', field_value: (data as any)?.title || null, confidence: 0.9 },
                { field_name: 'listing_location', field_value: loc.clean, confidence: loc.clean ? 0.7 : 0.2 },
                { field_name: 'listing_posted_at', field_value: (data as any)?.listing_posted_at || null, confidence: (data as any)?.listing_posted_at ? 0.9 : 0.4 },
                { field_name: 'listing_updated_at', field_value: (data as any)?.listing_updated_at || null, confidence: (data as any)?.listing_updated_at ? 0.8 : 0.4 },
                { field_name: 'year', field_value: yearNum ? String(yearNum) : null, confidence: yearNum ? 0.9 : 0.4 },
                { field_name: 'make', field_value: finalMake ? String(finalMake) : null, confidence: finalMake ? 0.8 : 0.4 },
                { field_name: 'model', field_value: finalModel ? String(finalModel) : null, confidence: finalModel ? 0.7 : 0.4 },
                { field_name: 'mileage', field_value: typeof (data as any)?.mileage === 'number' ? String((data as any).mileage) : null, confidence: typeof (data as any)?.mileage === 'number' ? 0.7 : 0.4 },
                { field_name: 'vin', field_value: (data as any)?.vin ? String((data as any).vin) : null, confidence: (data as any)?.vin ? 0.6 : 0.3 },
                { field_name: 'asking_price', field_value: (data as any)?.asking_price ? String((data as any).asking_price) : null, confidence: (data as any)?.asking_price ? 0.7 : 0.4 },
                { field_name: 'raw_listing_description', field_value: rawDesc || null, confidence: rawDesc ? 0.85 : 0.2 },
                ...provenanceSnippets.map((p) => ({ field_name: 'provenance_snippet', field_value: p, confidence: 0.7 })),
              ],
            })

            // Store a queryable external listing row (enables recrawl/sync tooling).
            await upsertExternalListing({
              vehicle_id: vehicleId,
              listing_url: queueItem.listing_url,
              listing_status: 'active',
              metadata: {
                source: 'craigslist',
                listing_url: queueItem.listing_url,
                title: (data as any)?.title || null,
                location: loc.clean,
                listing_posted_at: (data as any)?.listing_posted_at || null,
                listing_updated_at: (data as any)?.listing_updated_at || null,
                asking_price: (data as any)?.asking_price || (data as any)?.price || null,
                mileage: (data as any)?.mileage || null,
                vin: (data as any)?.vin || null,
                raw_description: rawDesc || null,
                provenance_snippets: provenanceSnippets,
                scraped_at: new Date().toISOString(),
                scraper: 'craigslist-queue',
                scraper_version: 'v1',
              }
            })

            // FORENSIC ENRICHMENT (replaces manual field assignment)
            console.log(`[DEBUG] Before forensic enrichment, vehicle data:`, { vehicleId, make: data.make, model: data.model, posted_date: data.posted_date })
            await supabase.rpc('process_scraped_data_forensically', {
              p_vehicle_id: vehicleId,
              p_scraped_data: data,
              p_source_url: queueItem.listing_url,
              p_scraper_name: 'craigslist-queue',
              p_context: { description: data.description }
            })
            console.log(`[DEBUG] After forensic enrichment`)

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
// Create timeline event ONLY if we have the listing posted date (not import date)
              const listingPostedAt = (data as any)?.listing_posted_at || data.posted_date
              if (listingPostedAt) {
              try {
                let eventDate: string | null = null
                
                // Parse listing posted date - must be valid, don't default to today
                try {
                  const parsedDate = new Date(listingPostedAt)
                  if (!isNaN(parsedDate.getTime())) {
                    // Extract just the date part (YYYY-MM-DD)
                    eventDate = parsedDate.toISOString().split('T')[0]
                  } else {
                    // Fallback: try regex extraction
                    const dateMatch = String(listingPostedAt).match(/(\d{4})-(\d{2})-(\d{2})/)
                    if (dateMatch) {
                      eventDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
                    }
                  }
                } catch (parseErr) {
                  // Fallback: try regex extraction
                  const dateMatch = String(listingPostedAt).match(/(\d{4})-(\d{2})-(\d{2})/)
                  if (dateMatch) {
                    eventDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
                  }
                }
                
                // Only create timeline event if we successfully parsed the listing date
                if (!eventDate) {
                  console.warn(`  ⚠️ Could not parse listing date for timeline event: ${listingPostedAt}`)
                } else {

                  // Idempotency: avoid duplicate "Listed on Craigslist" events for the same listing URL.
                  const { data: existingEvent } = await supabase
                    .from('timeline_events')
                    .select('id')
                    .eq('vehicle_id', vehicleId)
                    .eq('event_type', 'discovery')
                    .eq('source', 'craigslist')
                    .eq('metadata->>listing_url', queueItem.listing_url)
                    .limit(1)
                    .maybeSingle()

                  if (!existingEvent?.id) {
                    await supabase
                      .from('timeline_events')
                      .insert({
                        vehicle_id: vehicleId,
                        user_id: importUserId,
                        event_type: 'discovery',
                        source: 'craigslist',
                        title: `Listed on Craigslist`,
                        event_date: eventDate, // This is the listing posted date, not import date
                        description: `Vehicle listed for sale on Craigslist${data.asking_price ? ` for $${data.asking_price.toLocaleString()}` : ''}`,
                        metadata: {
                          listing_url: queueItem.listing_url,
                          asking_price: data.asking_price || null,
                          location: data.location || null,
                          posted_date: data.posted_date || null,
                          listing_posted_at: (data as any)?.listing_posted_at || null,
                          listing_updated_at: (data as any)?.listing_updated_at || null,
                        }
                      })
                  }
                }
              } catch (timelineErr) {
                console.warn(`  ⚠️ Timeline event creation error:`, timelineErr)
              }
            } else {
}

            // Download and upload images (skip if running low on time)
            const elapsedForImages = Date.now() - startTime
            if (data.images && data.images.length > 0 && elapsedForImages < skipImageProcessingAfter) {
              console.log(`  📸 Downloading ${data.images.length} images...`)
              let imagesUploaded = 0
              
              for (let i = 0; i < data.images.length; i++) {
                // Check time before each image
                const elapsedBeforeImage = Date.now() - startTime
                if (elapsedBeforeImage > skipImageProcessingAfter) {
                  console.log(`  ⏰ Skipping remaining ${data.images.length - i} images (time limit approaching)`)
                  break
                }
                
                const imageUrl = data.images[i]
                try {
                  const imageResponse = await fetch(imageUrl, {
                    signal: AbortSignal.timeout(5000) // Reduced from 10s to 5s
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
                  // Reduced delay from 500ms to 200ms
                  await new Promise(resolve => setTimeout(resolve, 200))
                  
                } catch (imgError) {
                  console.warn(`    ⚠️ Error processing image ${i + 1}:`, imgError)
                }
              }
              
              console.log(`  📸 Uploaded ${imagesUploaded} images`)
            } else if (data.images && data.images.length > 0) {
              console.log(`  ⏰ Skipping ${data.images.length} images (time limit approaching)`)
            }
          }
        } else {
          // Update existing vehicle
          const loc = normalizeListingLocation((data as any)?.location || null)
          await supabase
            .from('vehicles')
            .update({
              asking_price: data.asking_price || data.price || null,
              description: rawDesc || null,
              mileage: data.mileage || null,
              listing_source: 'craigslist',
              listing_url: queueItem.listing_url,
              listing_posted_at: (data as any)?.listing_posted_at || null,
              listing_updated_at: (data as any)?.listing_updated_at || null,
              listing_title: (data as any)?.title || null,
              listing_location: loc.clean,
              listing_location_raw: loc.raw,
              listing_location_observed_at: (data as any)?.listing_posted_at || (data as any)?.listing_updated_at || new Date().toISOString(),
              listing_location_source: 'craigslist',
              listing_location_confidence: loc.clean ? 0.6 : null,
            })
            .eq('id', vehicleId)

          await writeExtractionMetadata({
            vehicle_id: vehicleId,
            source_url: queueItem.listing_url,
            extraction_method: 'craigslist_scraper',
            scraper_version: 'v1',
            scraped_data: data,
            fields: [
              { field_name: 'listing_title', field_value: (data as any)?.title || null, confidence: 0.8 },
              { field_name: 'listing_location', field_value: loc.clean, confidence: loc.clean ? 0.6 : 0.2 },
              { field_name: 'listing_posted_at', field_value: (data as any)?.listing_posted_at || null, confidence: (data as any)?.listing_posted_at ? 0.8 : 0.4 },
              { field_name: 'listing_updated_at', field_value: (data as any)?.listing_updated_at || null, confidence: (data as any)?.listing_updated_at ? 0.7 : 0.4 },
              { field_name: 'vin', field_value: (data as any)?.vin ? String((data as any).vin) : null, confidence: (data as any)?.vin ? 0.6 : 0.3 },
              { field_name: 'mileage', field_value: typeof (data as any)?.mileage === 'number' ? String((data as any).mileage) : null, confidence: typeof (data as any)?.mileage === 'number' ? 0.7 : 0.4 },
              { field_name: 'asking_price', field_value: (data as any)?.asking_price ? String((data as any).asking_price) : null, confidence: (data as any)?.asking_price ? 0.7 : 0.4 },
              { field_name: 'raw_listing_description', field_value: rawDesc || null, confidence: rawDesc ? 0.8 : 0.2 },
            ],
          })

          await upsertExternalListing({
            vehicle_id: vehicleId,
            listing_url: queueItem.listing_url,
            listing_status: 'active',
            metadata: {
              source: 'craigslist',
              listing_url: queueItem.listing_url,
              title: (data as any)?.title || null,
              location: loc.clean,
              listing_posted_at: (data as any)?.listing_posted_at || null,
              listing_updated_at: (data as any)?.listing_updated_at || null,
              asking_price: (data as any)?.asking_price || (data as any)?.price || null,
              mileage: (data as any)?.mileage || null,
              vin: (data as any)?.vin || null,
              raw_description: rawDesc || null,
              scraped_at: new Date().toISOString(),
              scraper: 'craigslist-queue',
              scraper_version: 'v1',
            }
          })

          // Mark as complete for updated vehicles
          await supabase
            .from('craigslist_listing_queue')
            .update({
              status: 'complete',
              vehicle_id: vehicleId,
              processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', queueItem.id)

          console.log(`  ✅ Updated: ${yearNum} ${finalMake} ${finalModel}`)
          return { status: 'updated', vehicleId: vehicleId || undefined }
        }

        // Mark as complete for new vehicles
        await supabase
          .from('craigslist_listing_queue')
          .update({
            status: 'complete',
            vehicle_id: vehicleId,
            processed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', queueItem.id)

        console.log(`  ✅ Created: ${yearNum} ${finalMake} ${finalModel}`)
        return { status: 'created', vehicleId: vehicleId || undefined }

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

        return { status: 'failed' }
      }
    }

    // Process in parallel batches with concurrency limit
    for (let i = 0; i < queueItems.length; i += CONCURRENCY_LIMIT) {
      // Check if we're running out of time before starting a new batch
      const elapsed = Date.now() - startTime
      if (elapsed > maxExecutionTime) {
        console.log(`⏰ Time limit reached (${elapsed}ms). Stopping early. Processed ${stats.processed} listings.`)
        break
      }

      const batch = queueItems.slice(i, i + CONCURRENCY_LIMIT)
      const batchNum = Math.floor(i / CONCURRENCY_LIMIT) + 1
      const totalBatches = Math.ceil(queueItems.length / CONCURRENCY_LIMIT)
      
      console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} listings in parallel)...`)

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(queueItem => processQueueItem(queueItem))
      )

      // Aggregate results
      for (const result of batchResults) {
        stats.processed++
        if (result.status === 'fulfilled') {
          const outcome = result.value
          if (outcome.status === 'created') {
            stats.created++
          } else if (outcome.status === 'updated') {
            stats.updated++
          } else if (outcome.status === 'skipped') {
            stats.skipped++
          } else if (outcome.status === 'failed') {
            stats.failed++
          }
        } else {
          // Promise rejected - unexpected error
          console.error('Unexpected processing error:', result.reason)
          stats.failed++
        }
      }

      // Small delay between batches to avoid overwhelming the system
      if (i + CONCURRENCY_LIMIT < queueItems.length) {
        await new Promise(resolve => setTimeout(resolve, 300))
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

// Helper function to extract price from text, avoiding monthly payments
// Handles European-style formatting where period is thousands separator (e.g., $14.500 = $14,500)
function extractVehiclePrice(text: string): number | null {
  if (!text) return null;
  
  // Helper to normalize price string (handles both comma and period as thousands separators)
  const normalizePriceString = (priceStr: string): number | null => {
    // Remove $ and spaces
    let cleaned = priceStr.replace(/[\$\s]/g, '');
    
    // Handle European-style: $14.500 (period as thousands separator)
    // Pattern: digits.three_digits at the end suggests thousands separator
    const euroMatch = cleaned.match(/^(\d+)\.(\d{3})$/);
    if (euroMatch) {
      // This is European format (e.g., "14.500" = 14500)
      return parseInt(euroMatch[1] + euroMatch[2]);
    }
    
    // Handle standard format: $14,500 (comma as thousands separator)
    // Also handle mixed: $1,234.56 (comma thousands, period decimal)
    if (cleaned.includes(',') && cleaned.includes('.')) {
      // Has both comma and period - comma is thousands, period is decimal
      cleaned = cleaned.replace(/,/g, '');
      return Math.round(parseFloat(cleaned));
    }
    
    // Handle comma-only (thousands separator)
    if (cleaned.includes(',')) {
      cleaned = cleaned.replace(/,/g, '');
      return parseInt(cleaned);
    }
    
    // Handle period-only - need to determine if it's decimal or thousands separator
    if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      // If exactly 3 digits after period, likely thousands separator (e.g., "14.500")
      if (parts.length === 2 && parts[1].length === 3 && parts[1].match(/^\d{3}$/)) {
        // Thousands separator
        return parseInt(parts[0] + parts[1]);
      } else {
        // Decimal separator, round to integer
        return Math.round(parseFloat(cleaned));
      }
    }
    
    // No separators, just digits
    return parseInt(cleaned);
  };
  
  // First, try to find structured price fields (especially "Asking" which is common on Craigslist)
  const structuredPatterns = [
    /Asking[:\s]*\$?\s*([\d,.]+)/i,  // "Asking $14.500" or "Asking $14,500"
    /Price[:\s]*\$?\s*([\d,.]+)/i,
    /Sale\s+Price[:\s]*\$?\s*([\d,.]+)/i,
    /Vehicle\s+Price[:\s]*\$?\s*([\d,.]+)/i
  ];
  
  for (const pattern of structuredPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const price = normalizePriceString(match[1]);
      if (price && price >= 1000 && price < 10000000) {
        return price;
      }
    }
  }
  
  // Avoid monthly payment patterns
  if (text.match(/Est\.\s*payment|Monthly\s*payment|OAC[†]?/i)) {
    // Look for actual vehicle price, not monthly payment
    const vehiclePriceMatch = text.match(/(?:Price|Asking|Sale)[:\s]*\$?\s*([\d,.]+)/i);
    if (vehiclePriceMatch && vehiclePriceMatch[1]) {
      const price = normalizePriceString(vehiclePriceMatch[1]);
      if (price && price >= 1000 && price < 10000000) {
        return price;
      }
    }
    return null; // Don't extract if only monthly payment found
  }
  
  // Extract all prices and prefer the largest (vehicle prices are typically $5,000+)
  // Match both $14.500 (European) and $14,500 (US) formats
  const priceMatches = text.match(/\$\s*([\d,.]+)/g);
  if (priceMatches) {
    const prices = priceMatches
      .map(m => {
        const numMatch = m.match(/\$\s*([\d,.]+)/);
        return numMatch ? normalizePriceString(numMatch[1]) : null;
      })
      .filter((p): p is number => p !== null && p >= 1000 && p < 10000000);
    
    if (prices.length > 0) {
      // Return the largest valid price (likely the vehicle price)
      return Math.max(...prices);
    }
  }
  
  return null;
}

// Inline Craigslist scraping function (same as scrape-all-craigslist-squarebodies)
function scrapeCraigslistInline(doc: any, url: string): any {
const data: any = {
    source: 'Craigslist',
    listing_url: url
  }

  const titleElement = doc.querySelector('h1, .postingtitletext #titletextonly')
  if (titleElement) {
    data.title = titleElement.textContent.trim()
    
    // Step 1: Extract year from title
    const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) {
      data.year = yearMatch[0]
    }
    
    // Step 2: Extract make (common makes) - only set if found
    const makePatterns = [
      /\b(19|20)\d{2}\s+(Ford|Chevrolet|Chevy|GMC|Toyota|Honda|Nissan|Dodge|Jeep|BMW|Mercedes|Audi|Volkswagen|VW|Lexus|Acura|Infiniti|Mazda|Subaru|Mitsubishi|Hyundai|Kia|Volvo|Porsche|Jaguar|Land Rover|Range Rover|Tesla|Genesis|Alfa Romeo|Fiat|Mini|Cadillac|Buick|Pontiac|Oldsmobile|Lincoln|Chrysler)\b/i
    ]
    
    let makeFound = false
    for (const pattern of makePatterns) {
      const match = data.title.match(pattern)
      if (match && match[2]) {
        data.make = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase()
        // Normalize common variations
        if (data.make.toLowerCase() === 'chevy') data.make = 'Chevrolet'
        if (data.make.toLowerCase() === 'vw') data.make = 'Volkswagen'
        makeFound = true
        break
      }
    }
    
    // Step 3: Extract model - everything between make and price/location
    // Only set model if we found a make (don't guess)
    if (makeFound && data.make) {
      // Remove year and make from title
      const afterMake = data.title.replace(new RegExp(`\\b(19|20)\\d{2}\\s+${data.make}\\s+`, 'i'), '')
      
      // Strategy: Extract everything until we hit price ($) or end, then clean up
      // Handle titles like: "F-150 Super Crew Harley-Davidson Edition 4x4 (Edition #2798) - $14,995"
      let modelText = afterMake
      
      // Remove price if present (everything from $ onwards)
      modelText = modelText.replace(/\s*-\s*\$.*$/, '').replace(/\s*\$.*$/, '')
      
      // Remove location in parens at the end (but keep model name with dashes)
      // Pattern: (Location) or (Edition #123) at the end
      modelText = modelText.replace(/\s*\([^)]+\)\s*$/, '')
      
      // Remove common suffixes that aren't part of model name
      modelText = modelText.replace(/\s+(4x4|4wd|2wd|diesel|gas|automatic|manual)\s*$/i, '').trim()
      
      // Remove emojis and special characters that might be in the title
      modelText = modelText.replace(/[🚨🏁🏍️✨🧰⚙️🕒🛞🔥💺🧵🌞📡📷🧼🧷🏷️🏢🤝📍📞🌐💳🪙🧾]/g, '').trim()
      
      // Only set model if we have meaningful text (at least 2 chars)
      if (modelText && modelText.length >= 2) {
        data.model = modelText
      }
      // If modelText is empty or too short, leave data.model undefined (don't fill)
    }
const priceMatch = data.title.match(/\$\s*([\d,]+)/)
    if (priceMatch) data.asking_price = parseInt(priceMatch[1].replace(/,/g, ''))
    
    const locationMatch = data.title.match(/\(([^)]+)\)\s*$/i)
    if (locationMatch) data.location = locationMatch[1].trim()
  }

  // Extract price from .price element (primary method - more reliable than title)
  let initialPrice: number | null = null
  if (!data.asking_price) {
    const priceElement = doc.querySelector('.price')
    if (priceElement) {
      const priceText = priceElement.textContent?.trim() || ''
      const extractedPrice = extractVehiclePrice(priceText)
      if (extractedPrice) {
        initialPrice = extractedPrice
        data.asking_price = extractedPrice
      }
    }
  } else {
    initialPrice = data.asking_price
  }

  // Prefer Craigslist's map address/location when present (more precise than title parentheses).
  const mapAddr =
    (doc.querySelector('#mapaddress')?.textContent || doc.querySelector('.mapaddress')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
  if (mapAddr) data.location = mapAddr

  const fullText = doc.body?.textContent || ''
// Extract posted date from HTML
  // Craigslist shows "Posted 2025-11-27 15:00" in the HTML
  // Try multiple selectors and text patterns
  const postedDateSelectors = [
    'time.date',
    '.postinginfos time',
    'time[datetime]',
    '.postinginfo time',
    'span[class*="date"]',
    '.postingtitletext time',
    '.postinginfos',
    '.date'
  ]
  
  let postedDateFound = false
  
  // First try: Look for time elements with datetime attribute (prioritize the "posted" one, not "updated")
  // The HTML has: <time class="date timeago" datetime="2025-11-27T15:00:37-0800">
  const timeElements = doc.querySelectorAll('time.date, time[datetime]')
  let firstAny: string | null = null
  let firstPosted: string | null = null
  for (const dateElement of timeElements) {
    const datetime = dateElement.getAttribute('datetime')
    if (!datetime) continue
    const parentText = (dateElement?.parentElement?.textContent || '').toLowerCase()
    if (!firstAny) firstAny = datetime
    if (!firstPosted && parentText.includes('posted')) firstPosted = datetime
  }
  const chosen = firstPosted || firstAny
  if (chosen) {
    try {
      const parsedDate = new Date(chosen)
        if (!isNaN(parsedDate.getTime())) {
          data.posted_date = parsedDate.toISOString()
          postedDateFound = true
        }
      } catch (e) {
      // Continue to fallbacks
    }
  }
  
  // Fallback: Try selectors if time elements didn't work
  if (!postedDateFound) {
    for (const selector of postedDateSelectors) {
      const dateElement = doc.querySelector(selector)
      if (dateElement) {
        const datetime = dateElement.getAttribute('datetime')
        if (datetime) {
          try {
            const parsedDate = new Date(datetime)
            if (!isNaN(parsedDate.getTime())) {
              data.posted_date = parsedDate.toISOString()
              postedDateFound = true
break
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
    }
  }
  
  // Second try: Extract from text content patterns
  if (!postedDateFound) {
    // Pattern 1: "Posted 2025-11-27 15:00"
    const postedTextMatch = fullText.match(/Posted\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/i)
    if (postedTextMatch) {
      const [, year, month, day, hour, minute] = postedTextMatch
      const dateStr = `${year}-${month}-${day}T${hour}:${minute}:00`
      try {
        const parsedDate = new Date(dateStr)
        if (!isNaN(parsedDate.getTime())) {
          data.posted_date = parsedDate.toISOString()
          postedDateFound = true
}
      } catch (e) {
        // Continue
      }
    }
    
    // Pattern 2: "posted: 2025-11-27 15:00" (lowercase)
    if (!postedDateFound) {
      const postedLowerMatch = fullText.match(/posted:\s*(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/i)
      if (postedLowerMatch) {
        const [, year, month, day, hour, minute] = postedLowerMatch
        const dateStr = `${year}-${month}-${day}T${hour}:${minute}:00`
        try {
          const parsedDate = new Date(dateStr)
          if (!isNaN(parsedDate.getTime())) {
            data.posted_date = parsedDate.toISOString()
            postedDateFound = true
}
        } catch (e) {
          // Continue
        }
      }
    }
    
    // Pattern 3: Look for date in postinginfos text
    if (!postedDateFound) {
      const postingInfos = doc.querySelector('.postinginfos')
      if (postingInfos) {
        const infoText = postingInfos.textContent || ''
        const dateMatch = infoText.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/)
        if (dateMatch) {
          const [, year, month, day, hour, minute] = dateMatch
          const dateStr = `${year}-${month}-${day}T${hour}:${minute}:00`
          try {
            const parsedDate = new Date(dateStr)
            if (!isNaN(parsedDate.getTime())) {
              data.posted_date = parsedDate.toISOString()
              postedDateFound = true
}
          } catch (e) {
            // Continue
          }
        }
      }
    }
  }
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
  
  // Extract description from #postingbody (primary method)
  const descElement = doc.querySelector('#postingbody')
  if (descElement) {
    // Get full text content, clean up common CL artifacts
    let descText = descElement.textContent || descElement.innerText || ''
    // Remove QR code link text
    descText = descText.replace(/QR Code Link to This Post\s*/gi, '')
    // Remove excessive whitespace
    descText = descText.replace(/\s+/g, ' ').trim()
    // Store full description (up to 10k chars for comprehensive details)
    if (descText) {
      data.description = descText.substring(0, 10000)
      
      // IMPORTANT: Check description for price if:
      // 1. No price found yet, OR
      // 2. Price found is suspiciously low (< $3000) - Craigslist sellers often hide real price in description
      // This handles cases where seller puts fake/low price in price field but real price in description
      if (!data.asking_price || (initialPrice && initialPrice < 3000)) {
        const descPrice = extractVehiclePrice(descText)
        if (descPrice && descPrice >= 1000) {
          // If description has a higher/valid price, prefer it (likely the real asking price)
          if (!data.asking_price || descPrice > (data.asking_price || 0)) {
            data.asking_price = descPrice
          }
        }
      }
    }
  }
  
  // Fallback: try section.userbody if #postingbody not found
  if (!data.description) {
    const userbodyElement = doc.querySelector('section.userbody')
    if (userbodyElement) {
      // Extract text but skip the attributes section
      const postingBody = userbodyElement.querySelector('#postingbody')
      if (postingBody) {
        let descText = postingBody.textContent || postingBody.innerText || ''
        descText = descText.replace(/QR Code Link to This Post\s*/gi, '')
        descText = descText.replace(/\s+/g, ' ').trim()
        if (descText) {
          data.description = descText.substring(0, 10000)
          
          // Check description for price if price is missing or suspiciously low
          if (!data.asking_price || (initialPrice && initialPrice < 3000)) {
            const descPrice = extractVehiclePrice(descText)
            if (descPrice && descPrice >= 1000) {
              if (!data.asking_price || descPrice > (data.asking_price || 0)) {
                data.asking_price = descPrice
              }
            }
          }
        }
      }
    }
  }

  // Canonical keys for UI: listing_posted_at mirrors posted_date for Craigslist.
  if (data.posted_date && !data.listing_posted_at) data.listing_posted_at = data.posted_date

  // Best-effort VIN extraction from description if present.
  if (!data.vin && typeof data.description === 'string') {
    const vinMatch = data.description.toUpperCase().match(/\b([A-HJ-NPR-Z0-9]{17})\b/)
    if (vinMatch?.[1]) data.vin = vinMatch[1]
  }
// Comprehensive image extraction - multiple methods
  const images: string[] = []
  const seenUrls = new Set<string>()
  
  // Method 1: Thumbnail links (a.thumb elements)
  const thumbLinks = doc.querySelectorAll('a.thumb')
thumbLinks.forEach((link: any) => {
    const href = link.getAttribute('href')
    if (href && href.startsWith('http')) {
      // Upgrade to high-res: handle multiple URL formats
      let highResUrl = href
      // Format 1: /600x450/ in path -> /1200x900/
      highResUrl = highResUrl.replace(/\/\d+x\d+\//, '/1200x900/')
      // Format 2: _600x450.jpg at end -> _1200x900.jpg
      highResUrl = highResUrl.replace(/_(\d+)x(\d+)\.jpg$/i, '_1200x900.jpg')
      // Format 3: /50x50c/ -> /1200x900/
      highResUrl = highResUrl.replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl)) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  })
  
  // Method 2: img tags with images.craigslist.org URLs
  const imgTags = doc.querySelectorAll('img[src*="images.craigslist.org"]')
imgTags.forEach((img: any) => {
    const src = img.getAttribute('src')
    if (src && src.includes('images.craigslist.org')) {
      // Upgrade to high-res version - handle multiple URL formats
      let highResUrl = src
      // Format 1: /600x450/ in path -> /1200x900/
      highResUrl = highResUrl.replace(/\/\d+x\d+\//, '/1200x900/')
      // Format 2: _600x450.jpg at end -> _1200x900.jpg
      highResUrl = highResUrl.replace(/_(\d+)x(\d+)\.jpg$/i, '_1200x900.jpg')
      // Format 3: /50x50c/ -> /1200x900/
      highResUrl = highResUrl.replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl)) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  })
  
  // Method 3: data-src attributes (lazy loading)
  const lazyImages = doc.querySelectorAll('img[data-src*="images.craigslist.org"]')
  lazyImages.forEach((img: any) => {
    const dataSrc = img.getAttribute('data-src')
    if (dataSrc && dataSrc.includes('images.craigslist.org')) {
      // Upgrade to high-res version - handle multiple URL formats
      let highResUrl = dataSrc
      // Format 1: /600x450/ in path -> /1200x900/
      highResUrl = highResUrl.replace(/\/\d+x\d+\//, '/1200x900/')
      // Format 2: _600x450.jpg at end -> _1200x900.jpg
      highResUrl = highResUrl.replace(/_(\d+)x(\d+)\.jpg$/i, '_1200x900.jpg')
      // Format 3: /50x50c/ -> /1200x900/
      highResUrl = highResUrl.replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl)) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  })
  
  // Method 4: Extract from HTML regex (fallback for any missed images)
  const htmlText = doc.body?.innerHTML || ''
  const imageUrlRegex = /https?:\/\/images\.craigslist\.org\/[^"'\s>]+/gi
  let regexMatch
  while ((regexMatch = imageUrlRegex.exec(htmlText)) !== null) {
    const url = regexMatch[0]
    if (url && url.includes('images.craigslist.org')) {
      // Upgrade to high-res version - handle multiple URL formats
      let highResUrl = url
      // Format 1: /600x450/ in path -> /1200x900/
      highResUrl = highResUrl.replace(/\/\d+x\d+\//, '/1200x900/')
      // Format 2: _600x450.jpg at end -> _1200x900.jpg
      highResUrl = highResUrl.replace(/_(\d+)x(\d+)\.jpg$/i, '_1200x900.jpg')
      // Format 3: /50x50c/ -> /1200x900/
      highResUrl = highResUrl.replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl) && !highResUrl.includes('icon') && !highResUrl.includes('logo')) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  }
  
  // Method 5: Gallery/slideshow images (data attributes)
  const galleryImages = doc.querySelectorAll('[data-imgid], [data-index]')
  galleryImages.forEach((elem: any) => {
    const imgSrc = elem.getAttribute('data-src') || elem.getAttribute('data-img') || elem.querySelector('img')?.getAttribute('src')
    if (imgSrc && imgSrc.includes('images.craigslist.org')) {
      // Upgrade to high-res version - handle multiple URL formats
      let highResUrl = imgSrc
      // Format 1: /600x450/ in path -> /1200x900/
      highResUrl = highResUrl.replace(/\/\d+x\d+\//, '/1200x900/')
      // Format 2: _600x450.jpg at end -> _1200x900.jpg
      highResUrl = highResUrl.replace(/_(\d+)x(\d+)\.jpg$/i, '_1200x900.jpg')
      // Format 3: /50x50c/ -> /1200x900/
      highResUrl = highResUrl.replace(/\/50x50c\//, '/1200x900/')
      if (!seenUrls.has(highResUrl)) {
        images.push(highResUrl)
        seenUrls.add(highResUrl)
      }
    }
  })
  
  if (images.length > 0) {
    data.images = Array.from(new Set(images)).slice(0, 50)
  }
  // (debug removed) previously posted ingest logs to localhost during development
return data
}

