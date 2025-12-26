// Discovery function for SBX Cars - finds all listing URLs without scraping details
// Designed to run periodically to find new listings

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
      max_pages = 50,
      sections = ['auctions', 'upcoming', 'ended'],
    } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Supabase configuration' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    console.log(`🔍 Discovering SBX Cars listings from sections: ${sections.join(', ')}`)

    // Ensure scrape source exists
    let { data: source } = await supabase
      .from('scrape_sources')
      .select('id')
      .ilike('url', '%sbxcars.com%')
      .maybeSingle()

      if (!source?.id) {
        const { data: newSource, error: createError } = await supabase
          .from('scrape_sources')
          .insert({
            url: 'https://sbxcars.com',
            name: 'SBX Cars',
            source_type: 'auction_house',
            is_active: true,
          })
          .select('id')
          .single()

        if (createError) {
          console.error('Error creating source:', createError)
        } else {
          source = newSource
          console.log('✅ Created scrape source for sbxcars.com')
        }
      }

    const allListingUrls = new Set<string>()
    const stats = {
      pages_checked: 0,
      urls_found: 0,
      urls_new: 0,
      urls_existing: 0,
      errors: 0,
    }

    // Check each section
    for (const section of sections) {
      const baseUrl = `https://sbxcars.com/${section}`
      console.log(`📋 Checking section: ${baseUrl}`)

      // Try to find listing URLs using Firecrawl's scrape API
      if (firecrawlKey) {
        try {
          // Use Firecrawl to scrape the browse page
          const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: baseUrl,
              formats: ['html', 'links'],
              waitFor: 3000,
              onlyMainContent: false,
            }),
          })

          if (response.ok) {
            const data = await response.json()
            
            // Extract from links format
            if (data.data?.links) {
              for (const link of data.data.links) {
                if (link.url && link.url.includes('/listing/')) {
                  allListingUrls.add(link.url)
                  stats.urls_found++
                }
              }
            }

            // Also parse HTML for listing URLs (fallback)
            if (data.data?.html) {
              const html = data.data.html
              // Extract listing URLs from HTML
              const listingUrlPattern = /href=["'](https?:\/\/sbxcars\.com\/listing\/[^"']+)["']/gi
              let match
              while ((match = listingUrlPattern.exec(html)) !== null) {
                const url = match[1]
                if (!allListingUrls.has(url)) {
                  allListingUrls.add(url)
                  stats.urls_found++
                }
              }
            }

            stats.pages_checked++
          }
        } catch (error: any) {
          console.error(`Error checking ${baseUrl}:`, error.message)
          stats.errors++
        }
      }

      // Fallback: Direct fetch if Firecrawl fails
      if (stats.pages_checked === 0) {
        try {
          const response = await fetch(baseUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          })
          
          if (response.ok) {
            const html = await response.text()
            const listingUrlPattern = /href=["'](https?:\/\/sbxcars\.com\/listing\/[^"']+)["']/gi
            let match
            while ((match = listingUrlPattern.exec(html)) !== null) {
              const url = match[1]
              if (!allListingUrls.has(url)) {
                allListingUrls.add(url)
                stats.urls_found++
              }
            }
            stats.pages_checked++
          }
        } catch (error: any) {
          console.error(`Error with direct fetch ${baseUrl}:`, error.message)
          stats.errors++
        }
      }

      // Also try pagination for additional listings
      for (let page = 2; page <= max_pages; page++) {
        const pageUrl = `${baseUrl}?page=${page}`
        let foundAny = false
        
        try {
          if (firecrawlKey) {
            const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${firecrawlKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: pageUrl,
                formats: ['html', 'links'],
                waitFor: 2000,
                onlyMainContent: false,
              }),
            })

            if (response.ok) {
              const data = await response.json()
              
              if (data.data?.links) {
                for (const link of data.data.links) {
                  if (link.url && link.url.includes('/listing/')) {
                    allListingUrls.add(link.url)
                    stats.urls_found++
                    foundAny = true
                  }
                }
              }

              if (data.data?.html) {
                const html = data.data.html
                const listingUrlPattern = /href=["'](https?:\/\/sbxcars\.com\/listing\/[^"']+)["']/gi
                let match
                while ((match = listingUrlPattern.exec(html)) !== null) {
                  const url = match[1]
                  if (!allListingUrls.has(url)) {
                    allListingUrls.add(url)
                    stats.urls_found++
                    foundAny = true
                  }
                }
              }

              if (!foundAny) break // No more pages
              stats.pages_checked++
            } else {
              break // Page doesn't exist
            }
          } else {
            // Direct fetch fallback
            const response = await fetch(pageUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
            })
            
            if (response.ok) {
              const html = await response.text()
              const listingUrlPattern = /href=["'](https?:\/\/sbxcars\.com\/listing\/[^"']+)["']/gi
              let match
              while ((match = listingUrlPattern.exec(html)) !== null) {
                const url = match[1]
                if (!allListingUrls.has(url)) {
                  allListingUrls.add(url)
                  stats.urls_found++
                  foundAny = true
                }
              }
              
              if (!foundAny) break
              stats.pages_checked++
            } else {
              break
            }
          }
        } catch (error: any) {
          console.error(`Error checking page ${page}:`, error.message)
          break // Stop pagination on error
        }

        await new Promise(resolve => setTimeout(resolve, 500)) // Rate limit
      }
    }

    console.log(`📊 Found ${allListingUrls.size} unique listing URLs`)

    // Check which URLs are new (not in import_queue or vehicles)
    const listingUrlsArray = Array.from(allListingUrls)
    const newUrls: string[] = []

    for (const url of listingUrlsArray) {
      // Check import_queue
      const { data: inQueue } = await supabase
        .from('import_queue')
        .select('id')
        .eq('listing_url', url)
        .maybeSingle()

      if (inQueue) {
        stats.urls_existing++
        continue
      }

      // Check vehicles
      const { data: exists } = await supabase
        .from('vehicles')
        .select('id')
        .eq('discovery_url', url)
        .maybeSingle()

      if (exists) {
        stats.urls_existing++
        continue
      }

      newUrls.push(url)
      stats.urls_new++
    }

    // Add new URLs to import_queue
    if (newUrls.length > 0) {
      // Re-fetch source to ensure we have the ID
      if (!source?.id) {
        const { data: refetchedSource } = await supabase
          .from('scrape_sources')
          .select('id')
          .ilike('url', '%sbxcars.com%')
          .maybeSingle()
        if (refetchedSource) source = refetchedSource
      }
      const sourceId = source?.id

      const queueItems = newUrls.map(url => ({
        source_id: sourceId,
        listing_url: url,
        listing_title: null,
        status: 'pending',
        priority: 5,
        raw_data: {
          source: 'sbxcars',
          discovered_at: new Date().toISOString(),
        },
      }))

      const { error: insertError } = await supabase
        .from('import_queue')
        .insert(queueItems)

      if (insertError) {
        console.error('Error inserting into queue:', insertError)
        stats.errors++
      } else {
        console.log(`✅ Queued ${newUrls.length} new listings`)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          ...stats,
          total_unique_urls: allListingUrls.size,
          new_urls_queued: newUrls.length,
        },
        new_urls: newUrls.slice(0, 10), // Return first 10 as sample
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Error in discover-sbxcars-listings:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

