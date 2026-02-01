/**
 * LEARN FROM INVOICE
 * 
 * Reverse-engineers parts knowledge from real invoices/receipts:
 * 1. Parses invoice to extract parts, brands, prices, labor
 * 2. Indexes missing parts into catalog_parts
 * 3. Stores pricing intelligence
 * 4. Learns system organization patterns
 * 5. Learns labor patterns
 * 6. Builds brand-to-supplier mappings
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://deno.land/x/openai@v4.20.1/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface InvoiceLearningRequest {
  document_id: string
  vehicle_id?: string
  document_url: string
  shop_name?: string
  invoice_date?: string
}

interface ExtractedPart {
  part_number?: string
  brand?: string
  name: string
  description?: string
  quantity: number
  unit_price: number
  total_price: number
  category?: string
  system_category?: string // "Engine", "Transmission", "Electrical", etc.
}

interface ExtractedLabor {
  description: string
  hours?: number
  rate?: number
  total: number
  category?: string
  system_category?: string
}

interface EnhancedInvoiceData {
  vendor: string
  date: string
  totalAmount: number
  parts: ExtractedPart[]
  labor: ExtractedLabor[]
  systems?: Array<{
    name: string
    category: string
    parts: string[]
    total_cost: number
  }>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    const openai = new OpenAI({ apiKey: openaiKey })

    const {
      document_id,
      vehicle_id,
      document_url,
      shop_name,
      invoice_date
    }: InvoiceLearningRequest = await req.json()

    if (!document_id || !document_url) {
      throw new Error('document_id and document_url are required')
    }

    console.log(`[learn-from-invoice] Processing invoice: ${document_id}`)

    // Get vehicle info if provided
    let vehicleInfo: any = null
    if (vehicle_id) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('year, make, model')
        .eq('id', vehicle_id)
        .single()
      vehicleInfo = vehicle
    }

    // Step 1: Extract invoice data using AI Vision
    console.log('[learn-from-invoice] Extracting invoice data with AI...')
    
    const extractionPrompt = `You are an expert automotive invoice analyzer. Extract ALL parts, labor, and system organization from this invoice.

Return JSON with this exact structure:
{
  "vendor": "Shop/vendor name",
  "date": "YYYY-MM-DD",
  "totalAmount": 0.00,
  "parts": [
    {
      "part_number": "Part # if visible (e.g., M130, LTCD, GT101)",
      "brand": "Brand name (e.g., Motec, Bosch, Denso, MSD)",
      "name": "Full part name/description",
      "description": "Additional details",
      "quantity": 1,
      "unit_price": 0.00,
      "total_price": 0.00,
      "category": "ECU|Sensor|Harness|Connector|Software|Other",
      "system_category": "Engine|Transmission|Chassis|Electrical|Other"
    }
  ],
  "labor": [
    {
      "description": "Labor description (e.g., 'Installation', 'Dyno testing')",
      "hours": 0.0,
      "rate": 0.00,
      "total": 0.00,
      "category": "Installation|Fabrication|Programming|Testing|Other",
      "system_category": "Engine|Transmission|Chassis|Electrical|Other"
    }
  ],
  "systems": [
    {
      "name": "System name (e.g., 'Motec Engine management system')",
      "category": "Engine|Transmission|Chassis|Electrical",
      "parts": ["part_number1", "part_number2"],
      "total_cost": 0.00
    }
  ]
}

CRITICAL RULES:
- Extract EVERY part number visible (M130, LTCD, GT101, etc.)
- Extract EVERY brand name (Motec, Bosch, Denso, MSD, Lokar, etc.)
- Identify system groupings (e.g., all Motec parts = "Motec Engine management system")
- Extract labor hours if shown, or estimate from total/rate
- Categorize parts by type and system
- Be precise with numbers and part numbers
- Return ONLY valid JSON, no explanations`

    const isPDF = document_url.toLowerCase().endsWith('.pdf')
    
    let invoiceData: EnhancedInvoiceData

    if (isPDF) {
      // For PDFs, try to extract text first or use vision
      console.log('[learn-from-invoice] PDF detected, using Vision API')
      
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a precise invoice data extractor. Return only valid JSON.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { type: 'image_url', image_url: { url: document_url, detail: 'high' } }
            ]
          }
        ]
      })

      invoiceData = JSON.parse(completion.choices[0].message.content || '{}')
    } else {
      // For images, use Vision API
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a precise invoice data extractor. Return only valid JSON.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { type: 'image_url', image_url: { url: document_url, detail: 'high' } }
            ]
          }
        ]
      })

      invoiceData = JSON.parse(completion.choices[0].message.content || '{}')
    }

    console.log(`[learn-from-invoice] Extracted ${invoiceData.parts?.length || 0} parts, ${invoiceData.labor?.length || 0} labor items`)

    const vendorName = shop_name || invoiceData.vendor || 'Unknown'
    const invoiceDate = invoice_date || invoiceData.date || new Date().toISOString().split('T')[0]

    // Step 2: Index missing parts into catalog_parts
    console.log('[learn-from-invoice] Indexing parts into catalog...')
    
    const partsIndexed = []
    const pricingLearned = []

    for (const part of invoiceData.parts || []) {
      if (!part.name) continue

      // Check if part exists in catalog
      let existingPart = null
      if (part.part_number) {
        const { data } = await supabase
          .from('catalog_parts')
          .select('id, part_number, name, brand, price_current')
          .eq('part_number', part.part_number)
          .maybeSingle()
        existingPart = data
      }

      // If not found by part number, try by name + brand
      if (!existingPart && part.brand) {
        const { data } = await supabase
          .from('catalog_parts')
          .select('id, part_number, name, brand, price_current')
          .eq('name', part.name)
          .eq('brand', part.brand)
          .maybeSingle()
        existingPart = data
      }

      if (!existingPart) {
        // Add new part to catalog
        const { data: newPart, error } = await supabase
          .from('catalog_parts')
          .insert({
            part_number: part.part_number || `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: part.name,
            description: part.description || part.name,
            brand: part.brand,
            category: part.category,
            price_current: part.unit_price || part.total_price,
            currency: 'USD',
            source_type: 'invoice_learning',
            supplier_name: vendorName,
            manufacturer: part.brand,
            in_stock: true
          })
          .select('id, part_number')
          .single()

        if (error) {
          console.error(`[learn-from-invoice] Error inserting part ${part.name}:`, error)
        } else {
          partsIndexed.push({ part_number: newPart.part_number, name: part.name, action: 'created' })
          existingPart = { id: newPart.id, part_number: newPart.part_number }
        }
      } else {
        // Update existing part with invoice-learned price if better
        if (part.unit_price && (!existingPart.price_current || part.unit_price > 0)) {
          await supabase
            .from('catalog_parts')
            .update({
              price_current: part.unit_price,
              brand: part.brand || existingPart.brand,
              supplier_name: vendorName,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingPart.id)
        }
        partsIndexed.push({ part_number: existingPart.part_number, name: part.name, action: 'updated' })
      }

      // Store pricing intelligence
      if (existingPart && part.unit_price) {
        const { error: pricingError } = await supabase
          .from('invoice_learned_pricing')
          .insert({
            part_number: part.part_number || existingPart.part_number,
            brand: part.brand,
            part_name: part.name,
            price: part.total_price,
            unit_price: part.unit_price,
            quantity: part.quantity,
            source_invoice_id: document_id,
            source_document_url: document_url,
            shop_name: vendorName,
            vehicle_id: vehicle_id || null,
            vehicle_year: vehicleInfo?.year || null,
            vehicle_make: vehicleInfo?.make || null,
            vehicle_model: vehicleInfo?.model || null,
            invoice_date: invoiceDate,
            catalog_part_id: existingPart.id,
            confidence: 0.9
          })

        if (!pricingError) {
          pricingLearned.push({ part: part.name, price: part.unit_price })
        }
      }
    }

    // Step 3: Learn system organization patterns
    console.log('[learn-from-invoice] Learning system organization patterns...')
    
    const systemsLearned = []

    for (const system of invoiceData.systems || []) {
      if (!system.name || !system.parts || system.parts.length === 0) continue

      const { data: systemPattern, error } = await supabase
        .from('system_organization_patterns')
        .insert({
          system_name: system.name,
          system_category: system.category,
          part_numbers: system.parts,
          part_names: system.parts.map(p => {
            const part = invoiceData.parts?.find(part => part.part_number === p)
            return part?.name || p
          }),
          brands: [...new Set(system.parts.map(p => {
            const part = invoiceData.parts?.find(part => part.part_number === p)
            return part?.brand
          }).filter(Boolean))],
          learned_from_invoice_id: document_id,
          learned_from_shop: vendorName,
          vehicle_id: vehicle_id || null,
          vehicle_year: vehicleInfo?.year || null,
          vehicle_make: vehicleInfo?.make || null,
          vehicle_model: vehicleInfo?.model || null,
          total_system_cost: system.total_cost,
          confidence: 0.85
        })
        .select('id, system_name')
        .single()

      if (!error) {
        systemsLearned.push({ system: system.name, parts_count: system.parts.length })
      }
    }

    // Step 4: Learn labor patterns
    console.log('[learn-from-invoice] Learning labor patterns...')
    
    const laborLearned = []

    for (const labor of invoiceData.labor || []) {
      if (!labor.description || !labor.total) continue

      const hours = labor.hours || (labor.rate ? labor.total / labor.rate : null)

      if (hours) {
        const { error } = await supabase
          .from('labor_patterns_learned')
          .insert({
            work_description: labor.description,
            work_category: labor.category,
            system_category: labor.system_category,
            labor_hours: hours,
            labor_rate: labor.rate,
            labor_total: labor.total,
            parts_count: invoiceData.parts?.length || 0,
            system_complexity: invoiceData.parts && invoiceData.parts.length > 10 ? 'Complex' : 
                             invoiceData.parts && invoiceData.parts.length > 5 ? 'Moderate' : 'Simple',
            learned_from_invoice_id: document_id,
            learned_from_shop: vendorName,
            vehicle_id: vehicle_id || null,
            vehicle_year: vehicleInfo?.year || null,
            vehicle_make: vehicleInfo?.make || null,
            vehicle_model: vehicleInfo?.model || null,
            invoice_date: invoiceDate,
            confidence: 0.85
          })

        if (!error) {
          laborLearned.push({ description: labor.description, hours: hours })
        }
      }
    }

    // Step 5: Build brand-to-supplier mappings
    console.log('[learn-from-invoice] Building brand-to-supplier mappings...')
    
    const brandsSeen = new Set<string>()
    for (const part of invoiceData.parts || []) {
      if (part.brand) brandsSeen.add(part.brand)
    }

    for (const brand of brandsSeen) {
      const { data: existing } = await supabase
        .from('brand_supplier_mappings')
        .select('id, learned_from_count')
        .eq('brand_name', brand)
        .eq('supplier_name', vendorName)
        .maybeSingle()

      if (existing) {
        // Update count
        await supabase
          .from('brand_supplier_mappings')
          .update({
            learned_from_count: existing.learned_from_count + 1,
            last_seen_at: new Date().toISOString()
          })
          .eq('id', existing.id)
      } else {
        // Insert new mapping
        await supabase
          .from('brand_supplier_mappings')
          .insert({
            brand_name: brand,
            supplier_name: vendorName,
            supplier_type: 'Shop',
            learned_from_invoice_id: document_id
          })
      }
    }

    // Return summary
    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          invoice: {
            vendor: vendorName,
            date: invoiceDate,
            total: invoiceData.totalAmount
          },
          parts_indexed: partsIndexed.length,
          parts_details: partsIndexed,
          pricing_learned: pricingLearned.length,
          systems_learned: systemsLearned.length,
          systems_details: systemsLearned,
          labor_learned: laborLearned.length,
          labor_details: laborLearned,
          brands_mapped: brandsSeen.size
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('[learn-from-invoice] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

