import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ReceiptProcessingRequest {
  receipt_id?: string;
  file_url?: string;
  image_url?: string;
  image_base64?: string;
  user_id?: string;
  vehicle_id?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: ReceiptProcessingRequest = await req.json()
    const { receipt_id, file_url, image_url, image_base64, user_id, vehicle_id } = body
    const imageSource = file_url || image_url

    console.log('Processing receipt:', receipt_id || 'new', imageSource?.slice(0, 50))

    // Update receipt status if we have an ID
    if (receipt_id) {
      await supabaseClient
        .from('receipts')
        .update({ processing_status: 'processing' })
        .eq('id', receipt_id)
    }

    // Use Claude Vision to extract receipt data
    const extractedData = await extractWithClaude(imageSource, image_base64)

    // Update user's preferred retailers (learn from purchases)
    if (user_id && extractedData.vendor_name) {
      await updateUserRetailer(supabaseClient, user_id, extractedData)
    }

    // Create or update receipt record
    let finalReceiptId = receipt_id
    if (!receipt_id) {
      // Create new receipt
      const { data: newReceipt, error: insertError } = await supabaseClient
        .from('receipts')
        .insert({
          user_id,
          vehicle_id,
          vendor_name: extractedData.vendor_name,
          receipt_date: extractedData.transaction_date,
          subtotal: extractedData.subtotal,
          tax: extractedData.tax_amount,
          total: extractedData.total_amount,
          status: 'imported',
          processing_status: 'processed',
          metadata: {
            store_id: extractedData.store_id,
            store_name: extractedData.store_name,
            store_address: extractedData.store_address,
            source: 'receipt_scan',
          },
        })
        .select('id')
        .single()

      if (newReceipt) {
        finalReceiptId = newReceipt.id
      }
    } else {
      // Update existing receipt
      await supabaseClient
        .from('receipts')
        .update({
          processing_status: 'processed',
          vendor_name: extractedData.vendor_name,
          receipt_date: extractedData.transaction_date,
          subtotal: extractedData.subtotal,
          tax: extractedData.tax_amount,
          total: extractedData.total_amount,
          metadata: {
            store_id: extractedData.store_id,
            store_name: extractedData.store_name,
            store_address: extractedData.store_address,
          },
        })
        .eq('id', receipt_id)
    }

    // Insert extracted items
    if (finalReceiptId && extractedData.items && extractedData.items.length > 0) {
      const { error: itemsError } = await supabaseClient
        .from('receipt_items')
        .insert(
          extractedData.items.map((item: any) => ({
            receipt_id: finalReceiptId,
            description: item.description,
            part_number: item.part_number,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
            category: item.category
          }))
        )

      if (itemsError) {
        console.error('Error inserting receipt items:', itemsError)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        receipt_id: finalReceiptId,
        data: extractedData,
        items_count: extractedData.items?.length || 0,
        retailer: extractedData.vendor_name,
        retailer_learned: !!user_id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Receipt processing error:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

// Extract receipt data using Claude Vision
async function extractWithClaude(imageUrl?: string, imageBase64?: string) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  // Fallback to regex parsing if no API key
  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY, using fallback parser')
    return fallbackExtract()
  }

  const anthropic = new Anthropic({ apiKey })

  // Prepare image content
  let imageContent: any
  if (imageBase64) {
    imageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: imageBase64,
      },
    }
  } else if (imageUrl) {
    // Fetch and convert to base64
    const response = await fetch(imageUrl)
    const buffer = await response.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    imageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: base64,
      },
    }
  } else {
    return fallbackExtract()
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          imageContent,
          {
            type: 'text',
            text: `Extract ALL data from this auto parts receipt. Return JSON only, no markdown:

{
  "vendor_name": "AutoZone|OReilly|RockAuto|NAPA|etc (normalize name)",
  "store_id": "store number if visible",
  "store_name": "full store name with location",
  "store_address": "street address",
  "transaction_date": "YYYY-MM-DD",
  "subtotal": 0.00,
  "tax_amount": 0.00,
  "total_amount": 0.00,
  "items": [
    {
      "description": "part name as shown",
      "part_number": "ABC123 or null",
      "quantity": 1,
      "unit_price": 0.00,
      "line_total": 0.00,
      "category": "oil|filter|brake|electrical|steering|suspension|gasket|hardware|paint|tools|other"
    }
  ]
}

Extract EVERY line item. Include all part numbers visible. Normalize retailer names.`,
          },
        ],
      },
    ],
  })

  const responseText = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const jsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(jsonStr)
  } catch (e) {
    console.error('Failed to parse Claude response:', responseText.slice(0, 200))
    return fallbackExtract()
  }
}

// Update user's preferred retailers
async function updateUserRetailer(supabase: any, userId: string, data: any) {
  const retailer = data.vendor_name?.toLowerCase()
  if (!retailer) return

  const { data: existing } = await supabase
    .from('user_preferred_retailers')
    .select('id, purchase_count')
    .eq('user_id', userId)
    .eq('retailer', retailer)
    .eq('store_id', data.store_id || '')
    .maybeSingle()

  if (existing) {
    await supabase
      .from('user_preferred_retailers')
      .update({
        purchase_count: existing.purchase_count + 1,
        last_purchase_at: new Date().toISOString(),
        store_name: data.store_name,
        store_address: data.store_address,
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('user_preferred_retailers').insert({
      user_id: userId,
      retailer,
      store_id: data.store_id,
      store_name: data.store_name,
      store_address: data.store_address,
      purchase_count: 1,
      last_purchase_at: new Date().toISOString(),
    })
  }
}

// Fallback extraction without Claude
function fallbackExtract() {
  return {
    vendor_name: 'Unknown',
    store_id: null,
    store_name: null,
    store_address: null,
    transaction_date: new Date().toISOString().split('T')[0],
    subtotal: null,
    tax_amount: null,
    total_amount: 0,
    items: [],
    confidence_score: 0.5
  }
}

// Parse OCR text into structured data
function parseReceiptText(text: string) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)

  let vendor_name = ''
  let transaction_date = ''
  let total_amount = 0
  let tax_amount = 0
  const items: any[] = []

  // Extract vendor name (usually first non-empty line)
  if (lines.length > 0) {
    vendor_name = lines[0]
  }

  for (const line of lines) {
    // Extract date
    const dateMatch = line.match(/(?:Date:?\s*)?(\d{1,2}\/\d{1,2}\/\d{4})/i)
    if (dateMatch) {
      transaction_date = dateMatch[1]
    }

    // Extract total amount
    const totalMatch = line.match(/Total:?\s*\$?(\d+\.\d{2})/i)
    if (totalMatch) {
      total_amount = parseFloat(totalMatch[1])
    }

    // Extract tax amount
    const taxMatch = line.match(/Tax.*?\$?(\d+\.\d{2})/i)
    if (taxMatch) {
      tax_amount = parseFloat(taxMatch[1])
    }

    // Extract line items (description, part number, quantity, price)
    const itemMatch = line.match(/^(.+?)\s+([A-Z0-9-]+)?\s+(\d+)\s+\$?(\d+\.\d{2})\s+\$?(\d+\.\d{2})$/i)
    if (itemMatch) {
      const [, description, part_number, quantity, unit_price, line_total] = itemMatch

      items.push({
        description: description.trim(),
        part_number: part_number || null,
        quantity: parseInt(quantity),
        unit_price: parseFloat(unit_price),
        line_total: parseFloat(line_total),
        category: categorizeItem(description)
      })
    }
  }

  // Convert date format if found
  if (transaction_date) {
    try {
      const [month, day, year] = transaction_date.split('/')
      transaction_date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    } catch (e) {
      console.error('Date parsing error:', e)
      transaction_date = new Date().toISOString().split('T')[0]
    }
  }

  return {
    vendor_name,
    transaction_date: transaction_date || new Date().toISOString().split('T')[0],
    total_amount,
    tax_amount,
    items,
    confidence_score: 0.92,
    raw_data: { original_text: text }
  }
}

// Categorize items based on description
function categorizeItem(description: string): string {
  const desc = description.toLowerCase()

  if (desc.includes('oil') && desc.includes('filter')) return 'consumables'
  if (desc.includes('oil') || desc.includes('fluid')) return 'consumables'
  if (desc.includes('brake') || desc.includes('pad') || desc.includes('rotor')) return 'brakes'
  if (desc.includes('spark') || desc.includes('plug') || desc.includes('wire')) return 'electrical'
  if (desc.includes('filter')) return 'consumables'
  if (desc.includes('engine') || desc.includes('motor')) return 'engine'
  if (desc.includes('transmission') || desc.includes('trans')) return 'transmission'
  if (desc.includes('suspension') || desc.includes('shock') || desc.includes('spring')) return 'suspension'
  if (desc.includes('paint') || desc.includes('primer')) return 'paint'
  if (desc.includes('tool') || desc.includes('wrench') || desc.includes('socket')) return 'tools'
  if (desc.includes('gasket') || desc.includes('seal') || desc.includes('bolt')) return 'hardware'

  return 'hardware' // default category
}