/**
 * SCRAPE PROWIRE USA CATALOG (Edge Function)
 * 
 * Scrapes Deutsch connector products from prowireusa.com
 * Stores in catalog_parts for instant wiring quotes
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY')
    if (!FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured')
    }

    const { url, category_name } = await req.json()
    if (!url) throw new Error('Missing url')

    console.log(`🔥 Scraping ProWire catalog: ${url}`)

    // Scrape with Firecrawl
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        formats: ['html', 'markdown', 'extract'],
        extract: {
          schema: {
            type: 'object',
            properties: {
              products: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    part_number: { type: 'string' },
                    name: { type: 'string' },
                    price: { type: 'number' },
                    description: { type: 'string' },
                    image_url: { type: 'string' },
                    category: { type: 'string' }
                  }
                }
              }
            }
          }
        },
        waitFor: 3000
      })
    })

    if (!firecrawlResponse.ok) {
      throw new Error(`Firecrawl error: ${firecrawlResponse.status}`)
    }

    const firecrawlData = await firecrawlResponse.json()
    
    if (!firecrawlData.success) {
      throw new Error(`Firecrawl failed: ${JSON.stringify(firecrawlData)}`)
    }

    // Extract products
    let products = []
    
    if (firecrawlData.data?.extract?.products) {
      products = firecrawlData.data.extract.products
    } else {
      // Fallback: Parse HTML
      products = parseProductsFromHTML(
        firecrawlData.data?.html || '',
        firecrawlData.data?.markdown || '',
        category_name || 'wiring'
      )
    }

    // Get or create catalog source
    let { data: catalogSource } = await supabase
      .from('catalog_sources')
      .select('id')
      .eq('provider', 'ProWire')
      .single()

    if (!catalogSource) {
      const { data: newSource } = await supabase
        .from('catalog_sources')
        .insert({
          name: 'ProWire USA',
          provider: 'ProWire',
          base_url: 'https://www.prowireusa.com'
        })
        .select()
        .single()
      
      catalogSource = newSource
    }

    // Store products
    const stored = []
    const updated = []
    
    for (const product of products) {
      if (!product.part_number || !product.name) continue

      // Check if exists
      const { data: existing } = await supabase
        .from('catalog_parts')
        .select('id')
        .eq('part_number', product.part_number)
        .eq('catalog_id', catalogSource.id)
        .single()

      if (existing) {
        // Update
        await supabase
          .from('catalog_parts')
          .update({
            name: product.name,
            price_current: product.price,
            description: product.description,
            product_image_url: product.image_url,
            category: product.category || 'wiring',
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
        
        updated.push(product.part_number)
      } else {
        // Insert
        await supabase
          .from('catalog_parts')
          .insert({
            catalog_id: catalogSource.id,
            part_number: product.part_number,
            name: product.name,
            price_current: product.price,
            description: product.description,
            product_image_url: product.image_url,
            category: product.category || 'wiring',
            application_data: {
              supplier: 'ProWire USA',
              category: category_name || 'wiring'
            }
          })
        
        stored.push(product.part_number)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        products_found: products.length,
        stored: stored.length,
        updated: updated.length,
        products: products.slice(0, 10) // Return first 10 for preview
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function parseProductsFromHTML(html: string, markdown: string, category: string): any[] {
  const products = []
  
  // Multiple patterns for part numbers
  const partNumberPatterns = [
    // Deutsch connectors: DT-123, DTM-456, DTP-789, RBT-DT2, etc.
    /(?:DT|DTM|DTP|RBT)[-\s]?([0-9A-Z-]+)/gi,
    // Generic part numbers: 12345, ABC-123, etc.
    /(?:Part|SKU|Item|Model)[\s#:]*([A-Z0-9-]{3,20})/gi,
    // Common formats: 5025, 204W511-25-0, etc.
    /([A-Z0-9]{2,6}[-\s]?[0-9]+[A-Z0-9-]*)/gi
  ]
  
  const seenParts = new Set()
  
  for (const pattern of partNumberPatterns) {
    const partMatches = Array.from(html.matchAll(pattern))
    
    for (const match of partMatches) {
      let partNumber = match[0].replace(/\s+/g, '-').toUpperCase().trim()
      
      // Clean up common prefixes/suffixes
      partNumber = partNumber.replace(/^(PART|SKU|ITEM|MODEL)[-\s:]+/i, '')
      partNumber = partNumber.replace(/[-\s]+$/, '')
      
      if (seenParts.has(partNumber) || partNumber.length < 2 || partNumber.length > 30) continue
      seenParts.add(partNumber)
      
      // Find context around this part number
      const contextStart = Math.max(0, match.index - 300)
      const contextEnd = Math.min(html.length, match.index + 600)
      const context = html.substring(contextStart, contextEnd)
      
      // Extract name - try multiple patterns
      let name = null
      const namePatterns = [
        /<[^>]*class="[^"]*(?:title|name|product[_-]?name|product[_-]?title)[^"]*"[^>]*>(.*?)<\/[^>]*>/i,
        /<h[1-4][^>]*>(.*?)<\/h[1-4]>/i,
        /<strong[^>]*>(.*?)<\/strong>/i,
        /<a[^>]*href="[^"]*"[^>]*>(.*?)<\/a>/i,
        /<td[^>]*>(.*?)<\/td>/i
      ]
      
      for (const namePattern of namePatterns) {
        const nameMatch = context.match(namePattern)
        if (nameMatch && nameMatch[1]) {
          const candidate = nameMatch[1].replace(/<[^>]+>/g, '').trim()
          if (candidate.length > 3 && candidate.length < 200 && !candidate.includes(partNumber)) {
            name = candidate
            break
          }
        }
      }
      
      if (!name) {
        // Fallback: use part number as name
        name = partNumber
      }
      
      // Extract price
      const priceMatch = context.match(/\$([0-9]+(?:\.[0-9]{2,3})?)/)
      const price = priceMatch ? parseFloat(priceMatch[1]) : null
      
      // Extract image
      const imageMatch = context.match(/src="([^"]*\.(?:jpg|jpeg|png|webp))"/i) ||
                          html.match(new RegExp(`<img[^>]*${partNumber.replace(/[-\s]/g, '[^"]*')}[^"]*src="([^"]*)"`, 'i'))
      const imageUrl = imageMatch ? 
        (imageMatch[1].startsWith('http') ? imageMatch[1] : `https://www.prowireusa.com${imageMatch[1]}`) 
        : null
      
      // Extract description
      const descMatch = markdown.match(new RegExp(`${partNumber}[^\\n]{20,200}`, 'i'))
      const description = descMatch ? descMatch[0].substring(0, 500) : null
      
      products.push({
        part_number: partNumber,
        name: name,
        price: price,
        description: description,
        image_url: imageUrl,
        category: category || 'wiring'
      })
    }
    
    if (products.length > 0) break // Found pattern that works
  }
  
  return products
}

