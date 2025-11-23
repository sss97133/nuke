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

interface ImageMatch {
  imageId: string;
  imageUrl: string;
  takenAt: string;
  matchScore: number;
  matchReason: string;
  suggestedTags: string[];
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

    // Step 1: Extract receipt data using OpenAI Vision
    console.log(`[smart-receipt-linker] Extracting data from receipt: ${documentId}`);
    
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
      model: 'gpt-4o-mini',
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

    const receiptData: ReceiptData = JSON.parse(completion.choices[0].message.content || '{}');
    console.log(`[smart-receipt-linker] Extracted ${receiptData.lineItems?.length || 0} line items, confidence: ${receiptData.confidence}`);

    // Step 2: Find candidate images from same timeframe (±7 days from receipt date)
    const receiptDate = new Date(receiptData.date);
    const startDate = new Date(receiptDate);
    startDate.setDate(startDate.getDate() - 7);
    const endDate = new Date(receiptDate);
    endDate.setDate(endDate.getDate() + 7);

    const { data: candidateImages, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, image_url, large_url, taken_at, description, user_id')
      .eq('vehicle_id', vehicleId)
      .gte('taken_at', startDate.toISOString())
      .lte('taken_at', endDate.toISOString())
      .order('taken_at', { ascending: false })
      .limit(50);

    if (imagesError) throw imagesError;

    if (!candidateImages || candidateImages.length === 0) {
      console.log('[smart-receipt-linker] No images found in timeframe, skipping image matching');
      return new Response(
        JSON.stringify({
          success: true,
          receiptData,
          linkedImages: [],
          message: 'Receipt extracted but no images found in timeframe for linking'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Use AI to match receipt items to images
    console.log(`[smart-receipt-linker] Analyzing ${candidateImages.length} candidate images for matches`);

    const matchPrompt = `You are an automotive expert. Match receipt line items to vehicle images.

RECEIPT DATA:
${JSON.stringify(receiptData, null, 2)}

CANDIDATE IMAGES (${candidateImages.length} total):
${candidateImages.slice(0, 10).map((img, i) => `${i + 1}. ID: ${img.id}, Taken: ${img.taken_at}, Description: ${img.description || 'none'}`).join('\n')}

For each receipt line item, identify which images (by ID) show that part or the work being done. Return JSON:
{
  "matches": [
    {
      "imageId": "uuid",
      "matchedItems": ["Master Cylinder", "Brake Lines"],
      "matchScore": 0.85,
      "matchReason": "Image shows new master cylinder installed with brake lines visible",
      "suggestedTags": ["master_cylinder", "brake_system", "new_part"]
    }
  ]
}

Match criteria:
- Visual evidence of the part in the image
- Installation work in progress or completed
- Part packaging/boxes visible
- Tools relevant to that job
- Before/after shots
- Score 0.9-1.0: Definite match (part clearly visible)
- Score 0.7-0.89: Probable match (related work visible)
- Score 0.5-0.69: Possible match (context suggests)
- Below 0.5: Don't include

Return ONLY valid JSON.`;

    // Build image URLs array for vision analysis (limit to 10 for cost)
    const imageUrls = candidateImages.slice(0, 10).map(img => ({
      type: 'image_url' as const,
      image_url: { url: img.large_url || img.image_url }
    }));

    const matchCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an expert at matching automotive receipts to vehicle photos. Return only valid JSON.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: matchPrompt },
            ...imageUrls
          ]
        }
      ]
    });

    const matchResults = JSON.parse(matchCompletion.choices[0].message.content || '{"matches":[]}');
    const matches: ImageMatch[] = matchResults.matches || [];

    console.log(`[smart-receipt-linker] Found ${matches.length} image matches`);

    // Step 4: Persist receipt data and create valuation citations
    const { data: document } = await supabase
      .from('documents')
      .select('uploaded_by')
      .eq('id', documentId)
      .single();

    const uploaderId = document?.uploaded_by;

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

    // Create valuation citations for parts
    if (insertedItems && uploaderId) {
      const citationsToInsert = insertedItems
        .filter(item => item.category === 'part')
        .map(item => ({
          vehicle_id: vehicleId,
          component_type: 'part_purchase',
          component_name: item.description,
          value_usd: item.total_price,
          value_type: 'cost',
          submitted_by: uploaderId,
          submitter_role: 'uploader',
          effective_date: receiptData.date,
          evidence_type: 'receipt',
          source_document_id: documentId,
          confidence_score: Math.round(receiptData.confidence * 100),
          verification_status: 'receipt_confirmed',
          is_user_generated: false,
          metadata: {
            vendor: receiptData.vendor,
            receipt_date: receiptData.date,
            extracted_by_ai: true
          }
        }));

      if (citationsToInsert.length > 0) {
        const { error: citationError } = await supabase
          .from('valuation_citations')
          .insert(citationsToInsert);

        if (citationError) {
          console.error('[smart-receipt-linker] Error creating citations:', citationError);
        } else {
          console.log(`[smart-receipt-linker] Created ${citationsToInsert.length} valuation citations`);
        }
      }
    }

    // Step 5: Link receipt items to matched images via image_tags
    for (const match of matches) {
      const matchedImage = candidateImages.find(img => img.id === match.imageId);
      if (!matchedImage) continue;

      // Find receipt items that match this image
      const relevantItems = insertedItems?.filter(item =>
        match.matchedItems.some(desc =>
          item.description.toLowerCase().includes(desc.toLowerCase()) ||
          desc.toLowerCase().includes(item.description.toLowerCase())
        )
      );

      if (!relevantItems || relevantItems.length === 0) continue;

      // Create or update image tags linking to receipt items
      for (const item of relevantItems) {
        const tagData = {
          vehicle_id: vehicleId,
          image_id: match.imageId,
          tag_name: item.description,
          tag_type: item.category === 'part' ? 'part' : 'work',
          estimated_cost_cents: Math.round(item.total_price * 100),
          confidence: match.matchScore,
          receipt_line_item_id: item.id,
          ai_generated: true,
          ai_model: 'gpt-4o-mini',
          ai_reasoning: match.matchReason,
          metadata: {
            linked_by: 'smart-receipt-linker',
            linked_at: new Date().toISOString(),
            match_score: match.matchScore,
            suggested_tags: match.suggestedTags
          }
        };

        const { error: tagError } = await supabase
          .from('image_tags')
          .insert(tagData);

        if (tagError) {
          console.error(`[smart-receipt-linker] Error creating tag for image ${match.imageId}:`, tagError);
        } else {
          console.log(`[smart-receipt-linker] Linked receipt item "${item.description}" to image ${match.imageId}`);
        }
      }

      // Create valuation citations linking images to parts
      for (const item of relevantItems) {
        if (item.category !== 'part' || !uploaderId) continue;

        const imageCitation = {
          vehicle_id: vehicleId,
          component_type: 'part_value_estimate',
          component_name: item.description,
          value_usd: item.total_price,
          value_type: 'cost',
          submitted_by: uploaderId,
          submitter_role: 'ai',
          effective_date: matchedImage.taken_at?.split('T')[0] || receiptData.date,
          evidence_type: 'image_tag',
          source_image_id: match.imageId,
          source_document_id: documentId,
          confidence_score: Math.round(match.matchScore * 100),
          verification_status: 'unverified',
          is_user_generated: false,
          metadata: {
            match_reason: match.matchReason,
            linked_by: 'smart-receipt-linker'
          }
        };

        await supabase.from('valuation_citations').insert(imageCitation);
      }
    }

    // Step 6: Create timeline event for receipt processing
    await supabase.from('timeline_events').insert({
      vehicle_id: vehicleId,
      user_id: uploaderId,
      event_type: 'document_uploaded',
      event_date: receiptData.date || new Date().toISOString().split('T')[0],
      title: `Receipt processed: ${receiptData.vendor}`,
      description: `Extracted ${receiptData.lineItems.length} items (${receiptData.lineItems.filter(i => i.category === 'part').length} parts, ${receiptData.lineItems.filter(i => i.category === 'labor').length} labor). Linked to ${matches.length} images.`,
      metadata: {
        document_id: documentId,
        total_amount: receiptData.totalAmount,
        vendor: receiptData.vendor,
        linked_images: matches.length,
        confidence: receiptData.confidence
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        receiptData,
        linkedImages: matches.length,
        extractedItems: receiptData.lineItems.length,
        confidence: receiptData.confidence,
        matches: matches.map(m => ({
          imageId: m.imageId,
          matchScore: m.matchScore,
          reason: m.matchReason
        }))
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[smart-receipt-linker] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

