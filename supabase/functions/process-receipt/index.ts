import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ReceiptProcessingRequest {
  receipt_id: string;
  file_url: string;
}

interface TextractResponse {
  BlockMap: Record<string, any>;
  Blocks: Array<{
    BlockType: string;
    Text?: string;
    Confidence?: number;
    Geometry?: any;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { receipt_id, file_url }: ReceiptProcessingRequest = await req.json()

    console.log('Processing receipt:', receipt_id, file_url)

    // Update receipt status to processing
    await supabaseClient
      .from('receipts')
      .update({ processing_status: 'processing' })
      .eq('id', receipt_id)

    // For demo purposes, we'll simulate OCR processing
    // In production, you'd integrate with AWS Textract, Google Vision API, etc.
    const mockOCRResult = await simulateOCRProcessing(file_url)

    // Extract receipt data
    const extractedData = parseReceiptText(mockOCRResult.text)

    // Update receipt with extracted data
    const { error: updateError } = await supabaseClient
      .from('receipts')
      .update({
        processing_status: 'processed',
        vendor_name: extractedData.vendor_name,
        transaction_date: extractedData.transaction_date,
        total_amount: extractedData.total_amount,
        tax_amount: extractedData.tax_amount,
        raw_extraction: extractedData.raw_data,
        confidence_score: extractedData.confidence_score
      })
      .eq('id', receipt_id)

    if (updateError) {
      throw new Error(`Failed to update receipt: ${updateError.message}`)
    }

    // Insert extracted items
    if (extractedData.items && extractedData.items.length > 0) {
      const { error: itemsError } = await supabaseClient
        .from('receipt_items')
        .insert(
          extractedData.items.map((item: any) => ({
            receipt_id,
            ...item
          }))
        )

      if (itemsError) {
        console.error('Error inserting receipt items:', itemsError)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        receipt_id,
        extracted_items: extractedData.items?.length || 0,
        confidence_score: extractedData.confidence_score
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Receipt processing error:', error)

    // Update receipt status to failed if we have receipt_id
    try {
      const { receipt_id } = await req.json()
      if (receipt_id) {
        const supabaseClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        await supabaseClient
          .from('receipts')
          .update({ processing_status: 'failed' })
          .eq('id', receipt_id)
      }
    } catch (e) {
      console.error('Failed to update receipt status:', e)
    }

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

// Simulate OCR processing (replace with actual OCR service)
async function simulateOCRProcessing(fileUrl: string) {
  // In production, integrate with:
  // - AWS Textract for receipt analysis
  // - Google Vision API for document text detection
  // - Azure Cognitive Services for form recognizer

  console.log('Simulating OCR for:', fileUrl)

  // Mock OCR result with common automotive receipt patterns
  const mockText = `
AUTO PARTS WAREHOUSE
123 Main Street
Anytown, ST 12345
(555) 123-4567

Date: 03/15/2024
Receipt #: APW-789456

Engine Oil Filter     OEM-123456    1    $12.99    $12.99
5W-30 Motor Oil      MOB1-5W30     2    $14.99    $29.98
Spark Plugs Set      NGK-456789    1    $45.99    $45.99
Air Filter           AC-789012     1    $24.99    $24.99

                     Subtotal:             $113.95
                     Tax (8.25%):           $9.40
                     Total:               $123.35

Payment Method: VISA ****1234
Thank you for your business!
  `.trim()

  return {
    text: mockText,
    confidence: 0.92
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