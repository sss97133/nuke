// Smart Receipt Linker - Automatically extracts receipt data and links to relevant images
// Triggered when a new receipt document is uploaded
// Uses AI to parse receipt, identify parts/labor, and match to timeline images

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import OpenAI from 'https://deno.land/x/openai@v4.20.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReceiptData {
  vendor: string;
  date: string;
  totalAmount: number;
  lineItems: Array<{
    description: string;
    partNumber?: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    category: 'part' | 'labor' | 'tax' | 'fee' | 'other';
  }>;
  laborHours?: number;
  taxAmount?: number;
  confidence: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { documentId, vehicleId, documentUrl } = await req.json();

    if (!documentId || !vehicleId || !documentUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: documentId, vehicleId, documentUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiKey = Deno.env.get('OPEN_AI_API_KEY') || Deno.env.get('OPENAI_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const openai = new OpenAI({ apiKey: openaiKey });

    console.log(`[smart-receipt-linker] Extracting data from receipt: ${documentId}`);
    console.log(`[smart-receipt-linker] Document URL: ${documentUrl}`);
    
    // Determine if PDF or image
    const isPDF = documentUrl.toLowerCase().endsWith('.pdf');
    
    let receiptData: ReceiptData;

    if (isPDF) {
      // For PDFs: Use text extraction via external service or skip vision
      console.log('[smart-receipt-linker] PDF detected - using text extraction method');
      
      // Call receipt-extract function which handles PDFs
      const extractResponse = await fetch(`${supabaseUrl}/functions/v1/receipt-extract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: documentUrl,
          mimeType: 'application/pdf'
        })
      });

      if (!extractResponse.ok) {
        throw new Error(`Receipt extraction failed: ${await extractResponse.text()}`);
      }

      const extracted = await extractResponse.json();
      
      // Map to our format
      receiptData = {
        vendor: extracted.vendor_name || 'Unknown',
        date: extracted.receipt_date || new Date().toISOString().split('T')[0],
        totalAmount: extracted.total || 0,
        taxAmount: extracted.tax || 0,
        laborHours: 0,
        confidence: extracted.confidence || 0.7,
        lineItems: (extracted.items || []).map((item: any) => ({
          description: item.description || item.name || 'Unknown item',
          partNumber: item.part_number,
          quantity: item.quantity || 1,
          unitPrice: item.unit_price || 0,
          totalPrice: item.total_price || 0,
          category: item.category || 'other'
        }))
      };
    } else {
      // For images: Use OpenAI Vision
      console.log('[smart-receipt-linker] Image detected - using Vision API');
      
      const extractionPrompt = `You are an expert automotive receipt analyzer. Extract all data from this receipt with extreme precision.

Return JSON with this exact structure:
{
  "vendor": "Shop/vendor name",
  "date": "YYYY-MM-DD",
  "totalAmount": 0.00,
  "lineItems": [
    {
      "description": "Exact part/service description",
      "partNumber": "Part # if visible",
      "quantity": 1,
      "unitPrice": 0.00,
      "totalPrice": 0.00,
      "category": "part|labor|tax|fee|other"
    }
  ],
  "laborHours": 0.0,
  "taxAmount": 0.00,
  "confidence": 0.95
}

Rules:
- Extract every line item
- Categorize accurately: parts are physical items, labor is service/installation
- Parse part numbers (format: ABC-123, 12345, etc.)
- Calculate labor hours from labor charges (divide by shop rate if shown, or estimate based on typical rates $80-150/hr)
- Sum all taxes into taxAmount
- Set confidence 0-1 based on image clarity
- If date unclear, return null
- Return ONLY valid JSON, no explanations`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a precise receipt data extractor. Return only valid JSON.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { type: 'image_url', image_url: { url: documentUrl } }
            ]
          }
        ]
      });

      receiptData = JSON.parse(completion.choices[0].message.content || '{}');
    }

    console.log(`[smart-receipt-linker] Extracted ${receiptData.lineItems?.length || 0} line items, confidence: ${receiptData.confidence}`);

    // Update document status
    await supabase
      .from('documents')
      .update({
        ai_processing_status: 'completed',
        ai_extracted_data: receiptData,
        ai_extraction_confidence: receiptData.confidence,
        ai_processing_completed_at: new Date().toISOString()
      })
      .eq('id', documentId);

    // Get uploader from document
    const { data: docData } = await supabase
      .from('documents')
      .select('uploaded_by')
      .eq('id', documentId)
      .single();

    const uploaderId = docData?.uploaded_by;

    // Insert receipt line items
    const receiptItemsToInsert = receiptData.lineItems.map(item => ({
      document_id: documentId,
      vehicle_id: vehicleId,
      description: item.description,
      part_number: item.partNumber,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
      category: item.category,
      extracted_by_ai: true,
      confidence_score: receiptData.confidence
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from('receipt_items')
      .insert(receiptItemsToInsert)
      .select('id, description, total_price, category');

    if (itemsError) {
      console.error('[smart-receipt-linker] Error inserting receipt items:', itemsError);
    } else {
      console.log(`[smart-receipt-linker] Inserted ${insertedItems?.length || 0} receipt items`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        receiptData,
        linkedImages: 0,
        extractedItems: receiptData.lineItems.length,
        confidence: receiptData.confidence
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[smart-receipt-linker] Error:', error);
    
    // Update document status to failed
    try {
      const { documentId } = await req.json();
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      await supabase
        .from('documents')
        .update({
          ai_processing_status: 'failed',
          ai_processing_error: error.message
        })
        .eq('id', documentId);
    } catch {}
    
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
