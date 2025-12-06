/**
 * GENERATE WIRING QUOTE
 * 
 * Generates quotes for wiring systems including:
 * - Motec ECUs (the "nervous system")
 * - ProWire components (connectors, wire, etc.)
 * - Labor estimates
 * 
 * Handles products with and without prices
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface QuoteRequest {
  vehicle_id?: string
  parts?: string[] // Part numbers to include
  categories?: string[] // Categories to include (e.g., ['ECU', 'Software', 'Connectors'])
  suppliers?: string[] // Suppliers to include (e.g., ['Motec', 'ProWire'])
  include_labor?: boolean
  labor_rate?: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { 
      vehicle_id,
      parts = [],
      categories = [],
      suppliers = [],
      include_labor = true,
      labor_rate = 125.00
    }: QuoteRequest = await req.json()

    console.log('Generating wiring quote...')

    // Build query
    let query = supabase
      .from('catalog_parts')
      .select(`
        id,
        part_number,
        name,
        price_current,
        category,
        description,
        product_image_url,
        catalog_id,
        catalog_sources:catalog_id(provider, name)
      `)

    // Apply filters
    if (parts.length > 0) {
      query = query.in('part_number', parts)
    }

    if (categories.length > 0) {
      query = query.in('category', categories)
    }

    const { data: products, error } = await query.order('category')
    
    // Filter by supplier after fetching (since join filtering is complex)
    let filteredProducts = products || []
    if (suppliers.length > 0) {
      filteredProducts = filteredProducts.filter(p => 
        suppliers.includes(p.catalog_sources?.provider)
      )
    }

    if (error) {
      throw new Error(`Database error: ${error.message}`)
    }

    if (!filteredProducts || filteredProducts.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          quote: {
            parts: [],
            subtotal: 0,
            labor_total: 0,
            grand_total: 0,
            parts_with_prices: 0,
            parts_quote_required: 0
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check for invoice-learned pricing for parts without prices
    const partsWithoutPrices = filteredProducts.filter(p => !p.price_current || p.price_current === 0)
    const partNumbersToCheck = partsWithoutPrices.map(p => p.part_number).filter(Boolean)
    
    let learnedPricing: Record<string, number> = {}
    if (partNumbersToCheck.length > 0) {
      const { data: pricingData } = await supabase
        .from('invoice_learned_pricing')
        .select('part_number, unit_price, brand')
        .in('part_number', partNumbersToCheck)
        .order('learned_at', { ascending: false })

      if (pricingData) {
        // Use most recent price for each part
        for (const price of pricingData) {
          if (price.part_number && price.unit_price && !learnedPricing[price.part_number]) {
            learnedPricing[price.part_number] = price.unit_price
          }
        }
      }
    }

    // Organize by supplier
    const bySupplier: Record<string, any[]> = {}
    let partsWithPrices = 0
    let partsQuoteRequired = 0
    let partsSubtotal = 0

    filteredProducts.forEach(product => {
      const provider = product.catalog_sources?.provider || 'Unknown'
      if (!bySupplier[provider]) {
        bySupplier[provider] = []
      }

      // Use catalog price, or learned price, or mark as quote required
      let finalPrice = product.price_current
      let priceSource = 'catalog'
      
      if ((!finalPrice || finalPrice === 0) && product.part_number && learnedPricing[product.part_number]) {
        finalPrice = learnedPricing[product.part_number]
        priceSource = 'invoice_learned'
      }

      const hasPrice = finalPrice && finalPrice > 0
      if (hasPrice) {
        partsWithPrices++
        partsSubtotal += finalPrice
      } else {
        partsQuoteRequired++
      }

      bySupplier[provider].push({
        part_number: product.part_number,
        name: product.name,
        category: product.category,
        price: finalPrice,
        has_price: hasPrice,
        quote_required: !hasPrice,
        price_source: priceSource,
        description: product.description,
        image_url: product.product_image_url
      })
    })

    // Estimate labor - use learned patterns if available, otherwise defaults
    let laborHours = 0
    
    // Check for learned labor patterns
    const systemCategories = [...new Set(filteredProducts.map(p => {
      if (p.category?.toLowerCase().includes('ecu')) return 'Electrical'
      if (p.catalog_sources?.provider === 'ProWire') return 'Electrical'
      return null
    }).filter(Boolean))]

    if (systemCategories.length > 0 && vehicle_id) {
      // Try to find learned labor patterns for similar work
      const { data: learnedLabor } = await supabase
        .from('labor_patterns_learned')
        .select('labor_hours, work_description, system_category, parts_count')
        .in('system_category', systemCategories)
        .order('learned_at', { ascending: false })
        .limit(5)

      if (learnedLabor && learnedLabor.length > 0) {
        // Use average of similar learned patterns
        const avgHours = learnedLabor.reduce((sum, l) => sum + parseFloat(l.labor_hours), 0) / learnedLabor.length
        const similarPartsCount = learnedLabor[0]?.parts_count || filteredProducts.length
        
        // Scale based on parts count
        const scaleFactor = filteredProducts.length / similarPartsCount
        laborHours = Math.round(avgHours * scaleFactor)
        
        console.log(`Using learned labor pattern: ${avgHours.toFixed(1)} hours (scaled to ${laborHours} for ${filteredProducts.length} parts)`)
      }
    }

    // Fallback to defaults if no learned patterns
    if (laborHours === 0) {
      const hasECU = filteredProducts.some(p => 
        p.category?.toLowerCase().includes('ecu') || 
        p.name?.toLowerCase().includes('ecu')
      )
      const hasWiring = filteredProducts.some(p => 
        p.catalog_sources?.provider === 'ProWire' ||
        p.category?.toLowerCase().includes('connector') ||
        p.category?.toLowerCase().includes('wire')
      )
      const hasSoftware = filteredProducts.some(p => 
        p.category?.toLowerCase().includes('software')
      )

      if (hasECU) laborHours += 12 // ECU installation
      if (hasWiring) laborHours += 6 // Wiring installation
      if (hasSoftware) laborHours += 3 // Software configuration
    }

    const laborTotal = include_labor ? laborHours * labor_rate : 0

    // Build quote
    const quote = {
      vehicle_id: vehicle_id || null,
      parts: filteredProducts.map(p => ({
        part_number: p.part_number,
        name: p.name,
        category: p.category,
        supplier: p.catalog_sources?.provider || 'Unknown',
        price: p.price_current,
        has_price: p.price_current && p.price_current > 0,
        quote_required: !p.price_current || p.price_current === 0
      })),
      supplier_breakdown: Object.entries(bySupplier).map(([supplier, items]) => ({
        supplier,
        items: items.length,
        subtotal: items.reduce((sum, item) => sum + (item.price || 0), 0),
        quote_required_count: items.filter(item => !item.has_price).length
      })),
      pricing: {
        parts_subtotal: partsSubtotal,
        parts_with_prices: partsWithPrices,
        parts_quote_required: partsQuoteRequired,
        labor_hours: laborHours,
        labor_rate: labor_rate,
        labor_total: laborTotal,
        grand_total: partsSubtotal + laborTotal
      },
      summary: {
        total_parts: filteredProducts.length,
        suppliers: Object.keys(bySupplier),
        categories: [...new Set(filteredProducts.map(p => p.category).filter(Boolean))],
        has_complete_pricing: partsQuoteRequired === 0,
        estimated_complete: partsQuoteRequired === 0
      }
    }

    // Save quote if vehicle_id provided
    if (vehicle_id) {
      await supabase
        .from('parts_quotes')
        .insert({
          vehicle_id,
          quote_name: 'Wiring System Quote',
          parts: quote.parts,
          parts_subtotal: quote.pricing.parts_subtotal,
          labor_hours: quote.pricing.labor_hours,
          labor_rate: quote.pricing.labor_rate,
          labor_total: quote.pricing.labor_total,
          grand_total: quote.pricing.grand_total,
          supplier_breakdown: quote.supplier_breakdown,
          status: 'draft',
          ai_reasoning: `Generated wiring system quote with ${filteredProducts.length} parts from ${Object.keys(bySupplier).length} suppliers`
        })
    }

    return new Response(
      JSON.stringify({
        success: true,
        quote
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

