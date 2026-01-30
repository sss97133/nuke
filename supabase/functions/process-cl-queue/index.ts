import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { extractAndCacheFavicon } from '../_shared/extractFavicon.ts'
import { normalizeListingLocation } from '../_shared/normalizeListingLocation.ts'
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STORAGE_BUCKET = 'vehicle-data'

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
        const listingUrlKey = normalizeListingUrlKey(url)
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
              listing_url_key: listingUrlKey,
              listing_id: listingId || listingUrlKey,
              listing_status: args.listing_status,
              metadata: args.metadata ?? {},
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: 'platform,listing_url_key' }
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
                  const storagePath = `vehicles/${vehicleId}/images/craigslist_scrape/${fileName}`
                  
                  const { error: uploadError } = await supabase.storage
                    .from(STORAGE_BUCKET)
                    .upload(storagePath, uint8Array, {
                      contentType: `image/${ext}`,
                      cacheControl: '3600',
                      upsert: false
                    })
                  
                  if (uploadError) continue
                  
                  const { data: { publicUrl } } = supabase.storage
                    .from(STORAGE_BUCKET)
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

  const MAX_PRICE = 2_000_000;
  
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
      if (price && price >= 1000 && price < MAX_PRICE) {
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
      if (price && price >= 1000 && price < MAX_PRICE) {
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
      .filter((p): p is number => p !== null && p >= 1000 && p < MAX_PRICE);
    
    if (prices.length > 0) {
      // Return the largest valid price (likely the vehicle price)
      return Math.max(...prices);
    }
  }
  
  return null;
}

function cleanCraigslistTitle(raw: string | null | undefined): string {
  const input = (raw || '').trim()
  if (!input) return ''
  let cleaned = input.replace(/\s+/g, ' ').trim()
  // Remove image counters like "image 1 of 8" or "1/16"
  cleaned = cleaned.replace(/\bimage\s*\d+\s*of\s*\d+\b/gi, '')
  cleaned = cleaned.replace(/\b\d+\s*\/\s*\d+\b/g, '')
  // Remove mileage fragments that sometimes get appended to titles
  cleaned = cleaned.replace(/\b\d+(?:\.\d+)?\s*k?\s*mi\s*\d{4,6}\b/gi, '')
  cleaned = cleaned.replace(/\b\d+(?:\.\d+)?\s*k?\s*mi(?:les)?\b/gi, '')
  cleaned = cleaned.replace(/\bmi\s*\d{4,6}\b/gi, '')
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return cleaned
}

// ============================================================================
// ENHANCED CRAIGSLIST PARSING UTILITIES
// ============================================================================

// Remove emojis and special characters from text
function removeEmojis(text: string): string {
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation Selectors
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
    .replace(/[\u{231A}-\u{231B}]/gu, '')   // Watch, Hourglass
    .replace(/[\u{23E9}-\u{23F3}]/gu, '')   // Various symbols
    .replace(/[\u{23F8}-\u{23FA}]/gu, '')   // Various symbols
    .replace(/[\u{25AA}-\u{25AB}]/gu, '')   // Squares
    .replace(/[\u{25B6}]/gu, '')            // Play button
    .replace(/[\u{25C0}]/gu, '')            // Reverse button
    .replace(/[\u{25FB}-\u{25FE}]/gu, '')   // Squares
    .replace(/[\u{2614}-\u{2615}]/gu, '')   // Umbrella, Hot beverage
    .replace(/[\u{2648}-\u{2653}]/gu, '')   // Zodiac
    .replace(/[\u{267F}]/gu, '')            // Wheelchair
    .replace(/[\u{2693}]/gu, '')            // Anchor
    .replace(/[\u{26A1}]/gu, '')            // High voltage
    .replace(/[\u{26AA}-\u{26AB}]/gu, '')   // Circles
    .replace(/[\u{26BD}-\u{26BE}]/gu, '')   // Soccer, Baseball
    .replace(/[\u{26C4}-\u{26C5}]/gu, '')   // Snowman, Sun
    .replace(/[\u{26CE}]/gu, '')            // Ophiuchus
    .replace(/[\u{26D4}]/gu, '')            // No entry
    .replace(/[\u{26EA}]/gu, '')            // Church
    .replace(/[\u{26F2}-\u{26F3}]/gu, '')   // Fountain, Golf
    .replace(/[\u{26F5}]/gu, '')            // Sailboat
    .replace(/[\u{26FA}]/gu, '')            // Tent
    .replace(/[\u{26FD}]/gu, '')            // Fuel pump
    .replace(/[★☆✓✔✗✘●○◆◇▶►▷◀◁←→↑↓↔↕⇐⇒⇑⇓⬆⬇⬅➡]/g, '') // Common symbols
    .replace(/\s+/g, ' ')
    .trim()
}

// Model to make inference map (when title only has model)
const MODEL_TO_MAKE_MAP: Record<string, string> = {
  // Chevrolet/GMC trucks
  'c10': 'Chevrolet', 'c20': 'Chevrolet', 'c30': 'Chevrolet',
  'k10': 'Chevrolet', 'k20': 'Chevrolet', 'k30': 'Chevrolet',
  'c/k': 'Chevrolet', 'ck': 'Chevrolet',
  'silverado': 'Chevrolet', 'cheyenne': 'Chevrolet', 'scottsdale': 'Chevrolet',
  'blazer': 'Chevrolet', 'k5': 'Chevrolet', 'k5 blazer': 'Chevrolet',
  'suburban': 'Chevrolet', 'tahoe': 'Chevrolet',
  'jimmy': 'GMC', 'sierra': 'GMC', 'yukon': 'GMC',
  'squarebody': 'Chevrolet',
  // Ford
  'f100': 'Ford', 'f150': 'Ford', 'f250': 'Ford', 'f350': 'Ford',
  'f-100': 'Ford', 'f-150': 'Ford', 'f-250': 'Ford', 'f-350': 'Ford',
  'bronco': 'Ford', 'ranger': 'Ford', 'explorer': 'Ford', 'expedition': 'Ford',
  'mustang': 'Ford', 'thunderbird': 'Ford', 'falcon': 'Ford', 'fairlane': 'Ford',
  // Dodge/Ram
  'd100': 'Dodge', 'd150': 'Dodge', 'd200': 'Dodge', 'd250': 'Dodge',
  'w100': 'Dodge', 'w150': 'Dodge', 'w200': 'Dodge', 'w250': 'Dodge',
  'ramcharger': 'Dodge', 'power wagon': 'Dodge',
  'challenger': 'Dodge', 'charger': 'Dodge', 'dart': 'Dodge',
  // Jeep
  'wrangler': 'Jeep', 'cherokee': 'Jeep', 'grand cherokee': 'Jeep',
  'cj5': 'Jeep', 'cj7': 'Jeep', 'cj-5': 'Jeep', 'cj-7': 'Jeep',
  'gladiator': 'Jeep', 'comanche': 'Jeep', 'wagoneer': 'Jeep',
  // Toyota
  'tacoma': 'Toyota', 'tundra': 'Toyota', '4runner': 'Toyota',
  'land cruiser': 'Toyota', 'fj40': 'Toyota', 'fj60': 'Toyota', 'fj80': 'Toyota',
  'hilux': 'Toyota', 'pickup': 'Toyota', // context dependent
  'camry': 'Toyota', 'corolla': 'Toyota', 'supra': 'Toyota', 'celica': 'Toyota',
  // Nissan/Datsun
  '240z': 'Datsun', '260z': 'Datsun', '280z': 'Datsun', '280zx': 'Datsun',
  '300zx': 'Nissan', '350z': 'Nissan', '370z': 'Nissan',
  'pathfinder': 'Nissan', 'xterra': 'Nissan', 'frontier': 'Nissan',
  // Honda
  'civic': 'Honda', 'accord': 'Honda', 'prelude': 'Honda', 'crx': 'Honda',
  's2000': 'Honda', 'nsx': 'Honda', 'cr-v': 'Honda', 'pilot': 'Honda',
  // International
  'scout': 'International', 'scout ii': 'International', 'travelall': 'International',
  // Land Rover
  'defender': 'Land Rover', 'discovery': 'Land Rover', 'range rover': 'Land Rover',
  // Porsche
  '911': 'Porsche', '912': 'Porsche', '914': 'Porsche', '924': 'Porsche',
  '928': 'Porsche', '944': 'Porsche', '968': 'Porsche', 'boxster': 'Porsche',
  'cayman': 'Porsche', 'cayenne': 'Porsche', 'panamera': 'Porsche',
  // BMW
  'm3': 'BMW', 'm5': 'BMW', 'e30': 'BMW', 'e36': 'BMW', 'e46': 'BMW',
  '2002': 'BMW', '3 series': 'BMW', '5 series': 'BMW',
  // Mercedes
  'sl': 'Mercedes-Benz', 'slk': 'Mercedes-Benz', 'cls': 'Mercedes-Benz',
  'g-wagon': 'Mercedes-Benz', 'g wagon': 'Mercedes-Benz', 'g class': 'Mercedes-Benz',
  'w123': 'Mercedes-Benz', 'w124': 'Mercedes-Benz', 'w126': 'Mercedes-Benz',
  // Volkswagen
  'beetle': 'Volkswagen', 'bug': 'Volkswagen', 'bus': 'Volkswagen',
  'golf': 'Volkswagen', 'gti': 'Volkswagen', 'jetta': 'Volkswagen',
  'vanagon': 'Volkswagen', 'westfalia': 'Volkswagen', 'thing': 'Volkswagen',
  // Classics
  'corvette': 'Chevrolet', 'camaro': 'Chevrolet', 'chevelle': 'Chevrolet',
  'nova': 'Chevrolet', 'impala': 'Chevrolet', 'bel air': 'Chevrolet',
  'el camino': 'Chevrolet', 'monte carlo': 'Chevrolet',
  'gto': 'Pontiac', 'firebird': 'Pontiac', 'trans am': 'Pontiac',
  'cutlass': 'Oldsmobile', '442': 'Oldsmobile',
  'skylark': 'Buick', 'grand national': 'Buick', 'riviera': 'Buick',
  'cuda': 'Plymouth', 'barracuda': 'Plymouth', 'road runner': 'Plymouth',
}

// Extract location from Craigslist URL (e.g., "sfbay" from sfbay.craigslist.org)
function extractLocationFromUrl(url: string): string | null {
  const match = url.match(/https?:\/\/([^.]+)\.craigslist\.org/)
  if (match && match[1]) {
    const regionCode = match[1]
    // Map common region codes to readable names
    const regionMap: Record<string, string> = {
      'sfbay': 'San Francisco Bay Area',
      'losangeles': 'Los Angeles',
      'sandiego': 'San Diego',
      'sacramento': 'Sacramento',
      'fresno': 'Fresno',
      'bakersfield': 'Bakersfield',
      'seattle': 'Seattle',
      'portland': 'Portland',
      'phoenix': 'Phoenix',
      'tucson': 'Tucson',
      'denver': 'Denver',
      'dallas': 'Dallas',
      'houston': 'Houston',
      'austin': 'Austin',
      'sanantonio': 'San Antonio',
      'chicago': 'Chicago',
      'detroit': 'Detroit',
      'atlanta': 'Atlanta',
      'miami': 'Miami',
      'tampa': 'Tampa',
      'orlando': 'Orlando',
      'boston': 'Boston',
      'newyork': 'New York',
      'philadelphia': 'Philadelphia',
      'washingtondc': 'Washington DC',
      'baltimore': 'Baltimore',
      'minneapolis': 'Minneapolis',
      'stlouis': 'St. Louis',
      'kansascity': 'Kansas City',
      'lasvegas': 'Las Vegas',
      'saltlakecity': 'Salt Lake City',
      'albuquerque': 'Albuquerque',
      'honolulu': 'Honolulu',
      'anchorage': 'Anchorage',
      'inlandempire': 'Inland Empire',
      'orangecounty': 'Orange County',
      'ventura': 'Ventura',
      'santabarbara': 'Santa Barbara',
      'reno': 'Reno',
      'modesto': 'Modesto',
      'stockton': 'Stockton',
      'monterey': 'Monterey',
      'slo': 'San Luis Obispo',
      'palmsprings': 'Palm Springs',
    }
    return regionMap[regionCode.toLowerCase()] || regionCode.replace(/([a-z])([A-Z])/g, '$1 $2')
  }
  return null
}

// Parse attrgroup field with flexible matching
function parseAttrgroupField(text: string): { key: string; value: string } | null {
  // Normalize the text
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()

  // Try colon-separated format first: "key: value" or "key:value"
  const colonMatch = normalized.match(/^([^:]+):\s*(.+)$/)
  if (colonMatch) {
    return { key: colonMatch[1].trim(), value: colonMatch[2].trim() }
  }

  // Try space-separated format for known fields: "8 cylinders", "4wd", etc.
  const cylinderMatch = normalized.match(/^(\d+)\s*cylinders?$/)
  if (cylinderMatch) {
    return { key: 'cylinders', value: cylinderMatch[1] }
  }

  // Drive types without colon
  if (/^(4wd|awd|fwd|rwd|4x4|2wd)$/i.test(normalized)) {
    return { key: 'drive', value: normalized }
  }

  // Transmission without colon
  if (/^(automatic|manual|cvt|semi-?auto)$/i.test(normalized)) {
    return { key: 'transmission', value: normalized }
  }

  return null
}

// Enhanced description parsing for vehicle details
function parseDescriptionForDetails(description: string): {
  vin: string | null
  mileage: number | null
  condition: string | null
  engine: string | null
  transmission: string | null
  drivetrain: string | null
  title_status: string | null
  modifications: string[]
  confidence: Record<string, number>
} {
  const result = {
    vin: null as string | null,
    mileage: null as number | null,
    condition: null as string | null,
    engine: null as string | null,
    transmission: null as string | null,
    drivetrain: null as string | null,
    title_status: null as string | null,
    modifications: [] as string[],
    confidence: {} as Record<string, number>
  }

  if (!description) return result

  const text = description.replace(/\s+/g, ' ')
  const textLower = text.toLowerCase()

  // VIN extraction (standard 17-char, but also try to find partial/labeled VINs)
  const vinPatterns = [
    /\bvin[:#\s]*([A-HJ-NPR-Z0-9]{17})\b/i,  // "VIN: XXXXX" or "VIN#XXXXX"
    /\b([A-HJ-NPR-Z0-9]{17})\b/,              // Standard 17-char VIN
    /\bvin[:#\s]*([A-HJ-NPR-Z0-9]{11,16})\b/i // Partial VIN with label
  ]
  for (const pattern of vinPatterns) {
    const match = text.toUpperCase().match(pattern)
    if (match?.[1] && match[1].length >= 11) {
      result.vin = match[1]
      result.confidence['vin'] = match[1].length === 17 ? 0.95 : 0.6
      break
    }
  }

  // Mileage extraction - multiple patterns
  const mileagePatterns = [
    /(\d{1,3}(?:,\d{3})*)\s*(?:original\s+)?miles?\b/i,        // "125,000 miles" or "125000 original miles"
    /\b(?:odometer|odo)[:\s]*(\d{1,3}(?:,\d{3})*)/i,           // "odometer: 125,000"
    /(\d{1,3}(?:\.\d)?)\s*k\s*(?:original\s+)?mi(?:les?)?\b/i, // "125k miles" or "125.5k mi"
    /\bmileage[:\s]*(\d{1,3}(?:,\d{3})*)/i,                    // "mileage: 125,000"
    /(\d{1,3}(?:,\d{3})*)\s*(?:actual|showing|indicated)/i,    // "125,000 actual"
  ]
  for (const pattern of mileagePatterns) {
    const match = textLower.match(pattern)
    if (match?.[1]) {
      let mileage: number
      const numStr = match[1].replace(/,/g, '')
      if (numStr.includes('.') || textLower.includes('k mi') || textLower.includes('k miles')) {
        // Handle "125k" or "125.5k" format
        mileage = Math.round(parseFloat(numStr) * 1000)
      } else {
        mileage = parseInt(numStr)
      }
      // Sanity check: mileage should be reasonable (0 to 500,000)
      if (mileage >= 0 && mileage <= 500000) {
        result.mileage = mileage
        result.confidence['mileage'] = 0.8
        break
      }
    }
  }

  // Condition signals
  const conditionSignals = {
    excellent: ['excellent', 'pristine', 'perfect', 'immaculate', 'showroom', 'concours', 'museum quality', 'mint'],
    good: ['good', 'great', 'nice', 'solid', 'clean', 'well maintained', 'runs great', 'runs and drives', 'daily driver'],
    fair: ['fair', 'decent', 'okay', 'ok', 'runs', 'drives', 'needs tlc', 'needs work', 'minor issues'],
    poor: ['poor', 'rough', 'project', 'parts car', 'barn find', 'needs restoration', 'non-running', 'not running', 'doesn\'t run'],
    salvage: ['salvage', 'rebuilt', 'reconstructed', 'flood', 'fire damage', 'totaled']
  }

  for (const [condition, signals] of Object.entries(conditionSignals)) {
    for (const signal of signals) {
      if (textLower.includes(signal)) {
        result.condition = condition
        result.confidence['condition'] = 0.7
        break
      }
    }
    if (result.condition) break
  }

  // Engine extraction
  const enginePatterns = [
    /\b(\d{3,4})\s*(?:ci|cubic inch)/i,                        // "350ci" or "454 cubic inch"
    /\b(\d\.\d)\s*(?:l|liter)\s*(v?\d+|inline|i\d+)?/i,        // "5.7L V8" or "2.0L inline 4"
    /\b(ls[1-9x]|lt[1-5]|lsx|coyote|hemi|flathead|windsor|cleveland|boss)/i, // Engine names
    /\b(small\s*block|big\s*block|sbc|bbc)\s*(\d{3})?/i,       // "small block 350"
    /\b(v6|v8|v10|v12|inline[- ]?[46]|i[46]|flat[- ]?[46])\b/i, // Engine config
    /\bstraight[- ]?([468])\b/i,                               // "straight 6"
  ]

  for (const pattern of enginePatterns) {
    const match = text.match(pattern)
    if (match) {
      result.engine = match[0].trim()
      result.confidence['engine'] = 0.75
      break
    }
  }

  // Transmission
  const transPatterns = [
    /\b(automatic|auto|at)\b/i,
    /\b(manual|stick|standard|mt)\b/i,
    /\b(\d)[- ]?speed\s*(auto|manual|trans)?/i,  // "4-speed" or "5 speed manual"
    /\b(th350|th400|turbo\s*350|turbo\s*400|4l60|4l80|700r4|t5|t56|tremec|muncie|saginaw)\b/i,
    /\b(powerglide|hydramatic|overdrive)\b/i
  ]

  for (const pattern of transPatterns) {
    const match = textLower.match(pattern)
    if (match) {
      // Normalize common abbreviations
      let trans = match[0]
      if (/\bauto(?:matic)?\b/i.test(trans)) trans = 'automatic'
      else if (/\bmanual|stick|standard\b/i.test(trans)) trans = 'manual'
      result.transmission = trans
      result.confidence['transmission'] = 0.75
      break
    }
  }

  // Drivetrain
  const drivePatterns = [
    /\b(4x4|4wd|four wheel drive|4 wheel drive)\b/i,
    /\b(awd|all wheel drive|all-wheel drive)\b/i,
    /\b(2wd|rwd|rear wheel drive|rear-wheel drive)\b/i,
    /\b(fwd|front wheel drive|front-wheel drive)\b/i,
  ]

  for (const pattern of drivePatterns) {
    const match = textLower.match(pattern)
    if (match) {
      // Normalize
      const m = match[0].toLowerCase()
      if (m.includes('4x4') || m.includes('4wd') || m.includes('four wheel')) result.drivetrain = '4wd'
      else if (m.includes('awd') || m.includes('all wheel')) result.drivetrain = 'awd'
      else if (m.includes('rwd') || m.includes('rear wheel')) result.drivetrain = 'rwd'
      else if (m.includes('fwd') || m.includes('front wheel')) result.drivetrain = 'fwd'
      result.confidence['drivetrain'] = 0.8
      break
    }
  }

  // Title status
  const titlePatterns = [
    /\b(clean title|clear title)\b/i,
    /\b(salvage title|salvage)\b/i,
    /\b(rebuilt title|reconstructed title)\b/i,
    /\b(no title|lost title|title lost|missing title)\b/i,
    /\b(lien|lienholder)\b/i,
    /\b(bill of sale|bos only)\b/i,
  ]

  for (const pattern of titlePatterns) {
    const match = textLower.match(pattern)
    if (match) {
      const m = match[0].toLowerCase()
      if (m.includes('clean') || m.includes('clear')) result.title_status = 'clean'
      else if (m.includes('salvage')) result.title_status = 'salvage'
      else if (m.includes('rebuilt') || m.includes('reconstructed')) result.title_status = 'rebuilt'
      else if (m.includes('no title') || m.includes('lost') || m.includes('missing')) result.title_status = 'missing'
      else if (m.includes('lien')) result.title_status = 'lien'
      else if (m.includes('bill of sale')) result.title_status = 'bill of sale only'
      result.confidence['title_status'] = 0.8
      break
    }
  }

  // Modifications detection
  const modPatterns = [
    /\b(ls\s*swap|engine\s*swap|motor\s*swap)\b/i,
    /\b(lowered|lifted|leveled)\b/i,
    /\b(custom|aftermarket|upgraded|modified)\s*(exhaust|intake|suspension|wheels|interior)/i,
    /\b(headers|cam|intake|carb|fuel injection|efi)\b/i,
    /\b(disc brake|power steering|ac|air conditioning)\s*(conversion|swap|upgrade)/i,
  ]

  for (const pattern of modPatterns) {
    const match = text.match(pattern)
    if (match) {
      result.modifications.push(match[0].trim())
    }
  }

  return result
}

// Inline Craigslist scraping function (same as scrape-all-craigslist-squarebodies)
function scrapeCraigslistInline(doc: any, url: string): any {
const data: any = {
    source: 'Craigslist',
    listing_url: url,
    extraction_confidence: {} as Record<string, number>,
    raw_attrgroup: {} as Record<string, string>
  }

  const titleElement = doc.querySelector('h1, .postingtitletext #titletextonly')
  if (titleElement) {
    // Clean the title: remove emojis, normalize whitespace
    const rawTitle = titleElement.textContent || ''
    data.raw_title = rawTitle.trim()
    data.title = removeEmojis(cleanCraigslistTitle(rawTitle))

    // Step 1: Extract year from title
    const yearMatch = data.title.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) {
      data.year = yearMatch[0]
      data.extraction_confidence['year'] = 0.95
    }

    // Step 2: Extract make (common makes) - expanded list
    const makePatterns = [
      /\b(19|20)\d{2}\s+(Ford|Chevrolet|Chevy|GMC|Toyota|Honda|Nissan|Datsun|Dodge|Ram|Jeep|BMW|Mercedes|Mercedes-Benz|Benz|Audi|Volkswagen|VW|Lexus|Acura|Infiniti|Mazda|Subaru|Mitsubishi|Hyundai|Kia|Volvo|Porsche|Jaguar|Land Rover|Range Rover|Tesla|Genesis|Alfa Romeo|Fiat|Mini|Cadillac|Buick|Pontiac|Oldsmobile|Lincoln|Chrysler|Plymouth|AMC|International|IH|Scout|Willys|Kaiser|Studebaker|Hudson|Nash|Packard|DeSoto|Edsel|Mercury|Saturn|Geo|Isuzu|Suzuki|Saab|Triumph|MG|Austin|Morris|Sunbeam|Jensen|Lotus|Aston Martin|Ferrari|Lamborghini|Maserati|Bentley|Rolls-Royce|Rolls Royce)\b/i
    ]

    let makeFound = false
    for (const pattern of makePatterns) {
      const match = data.title.match(pattern)
      if (match && match[2]) {
        data.make = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase()
        // Normalize common variations
        const makeLower = data.make.toLowerCase()
        if (makeLower === 'chevy') data.make = 'Chevrolet'
        if (makeLower === 'vw') data.make = 'Volkswagen'
        if (makeLower === 'benz') data.make = 'Mercedes-Benz'
        if (makeLower === 'ih') data.make = 'International'
        if (makeLower === 'rolls royce') data.make = 'Rolls-Royce'
        data.extraction_confidence['make'] = 0.9
        makeFound = true
        break
      }
    }

    // Step 3: Extract model - everything between make and price/location
    let modelText = ''
    if (makeFound && data.make) {
      // Remove year and make from title
      const afterMake = data.title.replace(new RegExp(`\\b(19|20)\\d{2}\\s+${data.make}\\s+`, 'i'), '')
      modelText = afterMake
    } else {
      // No make found - try to extract model and infer make from it
      // Remove year first
      modelText = data.title.replace(/\b(19|20)\d{2}\s+/i, '')
    }

    // Clean up model text
    // Remove price if present (everything from $ onwards)
    modelText = modelText.replace(/\s*-\s*\$.*$/, '').replace(/\s*\$.*$/, '')

    // Remove location in parens at the end
    modelText = modelText.replace(/\s*\([^)]+\)\s*$/, '')

    // Remove common suffixes that aren't part of model name (but keep meaningful ones)
    modelText = modelText.replace(/\s+(diesel|gas|gasoline)\s*$/i, '').trim()

    // Clean any remaining special characters
    modelText = removeEmojis(modelText).trim()

    // If we have model text, try to extract meaningful parts
    if (modelText && modelText.length >= 2) {
      // Try to infer make from model if not found
      if (!makeFound) {
        const modelLower = modelText.toLowerCase()
        for (const [knownModel, inferredMake] of Object.entries(MODEL_TO_MAKE_MAP)) {
          if (modelLower.includes(knownModel)) {
            data.make = inferredMake
            data.extraction_confidence['make'] = 0.75 // Lower confidence for inference
            makeFound = true
            break
          }
        }
      }

      // Clean model text: remove make if it's duplicated at the start
      if (data.make) {
        const makeRegex = new RegExp(`^${data.make}\\s+`, 'i')
        modelText = modelText.replace(makeRegex, '').trim()
      }

      // Only set model if meaningful
      if (modelText.length >= 2) {
        data.model = modelText
        data.extraction_confidence['model'] = makeFound ? 0.8 : 0.6
      }
    }

    // Step 4: Try to extract from URL slug if title parsing failed
    if (!data.make || !data.model) {
      const urlSlug = url.match(/\/([^\/]+)\.html$/)?.[1]
      if (urlSlug) {
        // URL slugs look like: "plano-2016-kia-soul-with-only-miles" or "1977-chevrolet-c10-stepside"
        const slugParts = urlSlug.toLowerCase().split('-')

        // Find year in slug
        if (!data.year) {
          for (const part of slugParts) {
            if (/^(19|20)\d{2}$/.test(part)) {
              data.year = part
              data.extraction_confidence['year'] = 0.85
              break
            }
          }
        }

        // Find make in slug
        if (!data.make) {
          const makeTerms = ['chevrolet', 'chevy', 'ford', 'gmc', 'toyota', 'honda', 'dodge', 'jeep', 'nissan', 'bmw', 'mercedes', 'audi', 'volkswagen', 'porsche']
          for (const part of slugParts) {
            if (makeTerms.includes(part)) {
              data.make = part === 'chevy' ? 'Chevrolet' : part.charAt(0).toUpperCase() + part.slice(1)
              data.extraction_confidence['make'] = 0.7
              break
            }
          }
        }

        // Try to extract model from slug (word after make)
        if (data.make && !data.model) {
          const makeIndex = slugParts.findIndex(p =>
            p === data.make.toLowerCase() ||
            (data.make === 'Chevrolet' && p === 'chevy')
          )
          if (makeIndex >= 0 && makeIndex < slugParts.length - 1) {
            const modelCandidate = slugParts.slice(makeIndex + 1).join(' ')
              .replace(/\bwith\b.*$/i, '')
              .replace(/\bonly\b.*$/i, '')
              .trim()
            if (modelCandidate.length >= 2) {
              data.model = modelCandidate
              data.extraction_confidence['model'] = 0.6
            }
          }
        }
      }
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
// Enhanced attrgroup parsing - case-insensitive, whitespace-tolerant
  const attrGroups = doc.querySelectorAll('.attrgroup')
  attrGroups.forEach((group: any) => {
    const spans = group.querySelectorAll('span')
    spans.forEach((span: any) => {
      const rawText = (span.textContent || '').trim()
      if (!rawText) return

      // Store raw attrgroup data for audit trail
      const parsed = parseAttrgroupField(rawText)
      if (parsed) {
        data.raw_attrgroup[parsed.key] = parsed.value

        // Map to our schema fields with flexible matching
        const key = parsed.key.toLowerCase().replace(/\s+/g, '')
        const value = parsed.value

        switch (key) {
          case 'condition':
            data.condition = value
            data.extraction_confidence['condition'] = 0.9
            break
          case 'cylinders':
            const cylNum = parseInt(value)
            if (!isNaN(cylNum)) {
              data.cylinders = cylNum
              data.extraction_confidence['cylinders'] = 0.95
            }
            break
          case 'drive':
            data.drivetrain = value
            data.extraction_confidence['drivetrain'] = 0.9
            break
          case 'fuel':
          case 'fueltype':
            data.fuel_type = value
            data.extraction_confidence['fuel_type'] = 0.9
            break
          case 'odometer':
            // Handle various formats: "125,000", "125000", "125k"
            let odoValue = value.replace(/,/g, '').replace(/\s*miles?\s*/gi, '')
            if (odoValue.toLowerCase().endsWith('k')) {
              odoValue = String(parseFloat(odoValue) * 1000)
            }
            const mileage = parseInt(odoValue)
            if (!isNaN(mileage) && mileage >= 0 && mileage <= 999999) {
              data.mileage = mileage
              data.extraction_confidence['mileage'] = 0.95
            }
            break
          case 'paintcolor':
          case 'exteriorcolor':
          case 'color':
            data.color = value
            data.extraction_confidence['color'] = 0.9
            break
          case 'interiorcolor':
            data.interior_color = value
            data.extraction_confidence['interior_color'] = 0.9
            break
          case 'titlestatus':
          case 'title':
            data.title_status = value
            data.extraction_confidence['title_status'] = 0.9
            break
          case 'transmission':
            data.transmission = value
            data.extraction_confidence['transmission'] = 0.9
            break
          case 'type':
          case 'bodytype':
          case 'bodystyle':
            data.body_style = value
            data.extraction_confidence['body_style'] = 0.9
            break
          case 'vin':
            if (value.length >= 11) {
              data.vin = value.toUpperCase()
              data.extraction_confidence['vin'] = value.length === 17 ? 0.95 : 0.7
            }
            break
          case 'size':
          case 'enginesize':
            data.engine_size = value
            data.extraction_confidence['engine_size'] = 0.85
            break
          case 'make':
            data.make = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
            data.extraction_confidence['make'] = 0.95
            break
          case 'model':
            data.model = value
            data.extraction_confidence['model'] = 0.9
            break
        }
      } else {
        // Try to extract from unstructured text (e.g., "8 cylinders", "4wd")
        const textLower = rawText.toLowerCase()

        // Cylinders without label
        const cylMatch = textLower.match(/^(\d+)\s*cylinders?$/)
        if (cylMatch) {
          data.cylinders = parseInt(cylMatch[1])
          data.extraction_confidence['cylinders'] = 0.85
          data.raw_attrgroup['cylinders'] = cylMatch[1]
        }

        // Drive type without label
        if (/^(4wd|awd|fwd|rwd|4x4|2wd)$/i.test(textLower)) {
          data.drivetrain = textLower
          data.extraction_confidence['drivetrain'] = 0.85
          data.raw_attrgroup['drive'] = textLower
        }

        // Transmission without label
        if (/^(automatic|manual|cvt)$/i.test(textLower)) {
          data.transmission = textLower
          data.extraction_confidence['transmission'] = 0.85
          data.raw_attrgroup['transmission'] = textLower
        }
      }
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

  // Enhanced description parsing - extract VIN, mileage, condition, engine, transmission, etc.
  if (typeof data.description === 'string' && data.description.length > 0) {
    const descDetails = parseDescriptionForDetails(data.description)

    // VIN from description (if not already found in attrgroup)
    if (!data.vin && descDetails.vin) {
      data.vin = descDetails.vin
      data.extraction_confidence['vin'] = descDetails.confidence['vin'] || 0.7
    }

    // Mileage from description (if not already found in attrgroup)
    if (!data.mileage && descDetails.mileage) {
      data.mileage = descDetails.mileage
      data.extraction_confidence['mileage'] = descDetails.confidence['mileage'] || 0.7
    }

    // Condition from description (if not already found in attrgroup)
    if (!data.condition && descDetails.condition) {
      data.condition = descDetails.condition
      data.extraction_confidence['condition'] = descDetails.confidence['condition'] || 0.6
    }

    // Engine from description
    if (!data.engine && descDetails.engine) {
      data.engine = descDetails.engine
      data.extraction_confidence['engine'] = descDetails.confidence['engine'] || 0.7
    }

    // Transmission from description (if not already found)
    if (!data.transmission && descDetails.transmission) {
      data.transmission = descDetails.transmission
      data.extraction_confidence['transmission'] = descDetails.confidence['transmission'] || 0.65
    }

    // Drivetrain from description (if not already found)
    if (!data.drivetrain && descDetails.drivetrain) {
      data.drivetrain = descDetails.drivetrain
      data.extraction_confidence['drivetrain'] = descDetails.confidence['drivetrain'] || 0.7
    }

    // Title status from description (if not already found)
    if (!data.title_status && descDetails.title_status) {
      data.title_status = descDetails.title_status
      data.extraction_confidence['title_status'] = descDetails.confidence['title_status'] || 0.7
    }

    // Modifications detected
    if (descDetails.modifications.length > 0) {
      data.modifications = descDetails.modifications
    }
  }

  // Fallback VIN extraction if still not found (simple regex)
  if (!data.vin && typeof data.description === 'string') {
    const vinMatch = data.description.toUpperCase().match(/\b([A-HJ-NPR-Z0-9]{17})\b/)
    if (vinMatch?.[1]) {
      data.vin = vinMatch[1]
      data.extraction_confidence['vin'] = 0.6
    }
  }

  // Extract location from URL if not found in listing
  if (!data.location) {
    const urlLocation = extractLocationFromUrl(url)
    if (urlLocation) {
      data.location = urlLocation
      data.extraction_confidence['location'] = 0.6
    }
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

