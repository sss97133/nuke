/**
 * SCRAPE LMC PARTS
 * Uses existing Firecrawl API key to scrape product data from LMC website
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY')
    if (!FIRECRAWL_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { limit = 10 } = await req.json().catch(() => ({}))

    console.log(`🔍 Fetching ${limit} parts without images...`)

    // Get parts that need images
    const { data: parts, error: fetchError } = await supabase
      .from('catalog_parts')
      .select('id, part_number, name, category, price_current')
      .is('product_image_url', null)
      .limit(limit)

    if (fetchError) {
      throw new Error(`Database error: ${fetchError.message}`)
    }

    console.log(`📦 Found ${parts.length} parts to process`)

    const results = {
      total: parts.length,
      success: 0,
      failed: 0,
      parts: [] as any[]
    }

    for (const part of parts) {
      console.log(`\n🔥 Scraping: ${part.part_number} - ${part.name}`)

      const searchUrl = `https://www.lmctruck.com/search?query=${encodeURIComponent(part.part_number)}`

      try {
        // Scrape search page with Firecrawl
        const searchResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: searchUrl,
            formats: ['markdown', 'html']
          })
        })

        if (!searchResp.ok) {
          const errorText = await searchResp.text()
          console.log(`   ⚠️  Firecrawl search failed: ${searchResp.status}`, errorText)
          results.failed++
          continue
        }

        const searchData = await searchResp.json()
        console.log(`   📊 Search response:`, JSON.stringify(searchData).substring(0, 200))
        const searchHtml = searchData.data?.html || ''

        // Find product URL
        const productLinkMatch = searchHtml.match(/href="([^"]*\/products\/[^"]*)"/)
        if (!productLinkMatch) {
          console.log(`   ⚠️  No product found`)
          results.failed++
          continue
        }

        let productUrl = productLinkMatch[1]
        if (!productUrl.startsWith('http')) {
          productUrl = `https://www.lmctruck.com${productUrl}`
        }

        console.log(`   📄 Product: ${productUrl}`)

        // Scrape product page
        const productResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: productUrl,
            formats: ['markdown', 'html']
          })
        })

        if (!productResp.ok) {
          console.log(`   ⚠️  Product page failed: ${productResp.status}`)
          results.failed++
          continue
        }

        const productData = await productResp.json()
        const productHtml = productData.data?.html || ''
        const productMarkdown = productData.data?.markdown || ''

        // Extract data
        const imageMatch = productHtml.match(/src="([^"]*(?:product|item|image)[^"]*\.(?:jpg|jpeg|png|webp))"/i)
        const productImageUrl = imageMatch ? 
          (imageMatch[1].startsWith('http') ? imageMatch[1] : `https://www.lmctruck.com${imageMatch[1]}`) 
          : null

        const priceMatch = productHtml.match(/\$(\d+\.?\d*)/)
        const price = priceMatch ? parseFloat(priceMatch[1]) : null

        const lowerContent = (productMarkdown + productHtml).toLowerCase()
        const inStock = !lowerContent.includes('out of stock') && 
                       !lowerContent.includes('discontinued')

        // Get description from markdown
        const descLines = productMarkdown.split('\n')
          .filter((line: string) => line.trim().length > 30 && !line.startsWith('#'))
          .slice(0, 3)
        const description = descLines.length > 0 ? descLines.join(' ').substring(0, 500) : null

        // Update database
        const updateData: any = {
          product_image_url: productImageUrl,
          supplier_url: productUrl,
          in_stock: inStock
        }

        if (description) updateData.description = description
        if (price && price !== part.price_current) updateData.price_current = price

        const { error: updateError } = await supabase
          .from('catalog_parts')
          .update(updateData)
          .eq('id', part.id)

        if (updateError) {
          console.log(`   ❌ Update failed: ${updateError.message}`)
          results.failed++
        } else {
          console.log(`   ✅ Updated successfully`)
          results.success++
          results.parts.push({
            part_number: part.part_number,
            name: part.name,
            image_url: productImageUrl,
            price: price,
            url: productUrl
          })
        }

      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`)
        results.failed++
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    return new Response(
      JSON.stringify({
        success: true,
        ...results,
        message: `Processed ${results.total} parts: ${results.success} success, ${results.failed} failed`
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

