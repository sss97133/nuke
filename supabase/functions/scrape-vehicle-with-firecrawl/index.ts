/**
 * Scrape Vehicle with Firecrawl (403 Bypass)
 * 
 * Uses Firecrawl API to bypass Cloudflare and other protections
 * Falls back to direct fetch if Firecrawl fails
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY')
    
    // Try Firecrawl first if API key is configured
    if (firecrawlApiKey) {
      try {
        console.log('🔥 Using Firecrawl to fetch:', url)
        
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            pageOptions: {
              waitFor: 1000, // Wait 1 second for JS to load
            },
            formats: ['html', 'markdown']
          })
        })

        if (firecrawlResponse.ok) {
          const firecrawlData = await firecrawlResponse.json()
          
          if (firecrawlData.success && firecrawlData.data?.html) {
            console.log('✅ Firecrawl fetch successful')
            
            // Return HTML for processing
            return new Response(
              JSON.stringify({
                success: true,
                html: firecrawlData.data.html,
                markdown: firecrawlData.data.markdown,
                metadata: firecrawlData.data.metadata,
                source: 'firecrawl'
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
        } else {
          console.warn('⚠️ Firecrawl failed:', firecrawlResponse.status)
        }
      } catch (error) {
        console.warn('⚠️ Firecrawl error:', error)
        // Fall through to direct fetch
      }
    }

    // Fallback: Direct fetch (existing logic)
    console.log('📡 Using direct fetch (fallback)')
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
    }

    const html = await response.text()

    return new Response(
      JSON.stringify({
        success: true,
        html,
        source: 'direct'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

