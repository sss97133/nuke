// AI Image Scanner for Organizations
// Scans images to extract: tags, inventory (tools, equipment, parts), and metadata

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface ScanRequest {
  imageId: string;
  imageUrl: string;
  organizationId: string;
}

interface ScanResult {
  tags: string[];
  inventory: InventoryItem[];
  equipment: string[];
  parts: string[];
  description: string;
  confidence: number;
}

interface InventoryItem {
  name: string;
  category: 'tool' | 'equipment' | 'part' | 'material' | 'vehicle';
  brand?: string;
  model?: string;
  condition?: string;
  quantity?: number;
  confidence: number;
}

const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { imageId, imageUrl, organizationId }: ScanRequest = await req.json();
    
    if (!imageId || !imageUrl || !organizationId) {
      throw new Error('Missing required fields: imageId, imageUrl, organizationId');
    }

    // Get user from auth header (optional for attribution)
    let userId = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id;
    }

    console.log('Scanning image:', imageId, imageUrl);

    // Call OpenAI Vision API with structured prompt
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert automotive shop inventory analyst and equipment appraiser. 
Your task is to analyze images from automotive/performance shops and extract:

1. **Inventory Items**: Tools, equipment, parts, materials, vehicles visible
2. **Tags**: Descriptive keywords (e.g., "engine_rebuild", "fabrication", "dyno_testing")
3. **Description**: Brief summary of what's happening in the image

For each inventory item, identify:
- Name (specific as possible)
- Category: tool, equipment, part, material, or vehicle
- Brand/Manufacturer (if visible)
- Model/Part number (if visible)
- Condition: excellent, good, fair, poor
- Quantity (if multiple visible)
- Confidence: 0.0-1.0 (how certain you are)

Return ONLY valid JSON with this structure:
{
  "tags": ["tag1", "tag2", ...],
  "inventory": [
    {
      "name": "Item name",
      "category": "tool|equipment|part|material|vehicle",
      "brand": "Brand name",
      "model": "Model/part number",
      "condition": "excellent|good|fair|poor",
      "quantity": 1,
      "confidence": 0.95
    }
  ],
  "equipment": ["Equipment item 1", "Equipment item 2"],
  "parts": ["Part 1", "Part 2"],
  "description": "Brief description of the scene",
  "confidence": 0.9
}`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analyze this shop image and extract all visible inventory, equipment, parts, and tags.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 2000,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content from AI');
    }

    let scanResult: ScanResult;
    try {
      scanResult = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse AI response:', content);
      throw new Error('Invalid AI response format');
    }

    console.log('AI scan result:', scanResult);

    // Store tags in organization_image_tags table
    if (scanResult.tags && scanResult.tags.length > 0) {
      const tagInserts = scanResult.tags.map(tag => ({
        organization_id: organizationId,
        image_id: imageId,
        tag: tag.toLowerCase(),
        tagged_by: userId,
        confidence: scanResult.confidence || 0.8
      }));

      await supabase
        .from('organization_image_tags')
        .upsert(tagInserts, { onConflict: 'image_id,tag', ignoreDuplicates: false });
    }

    // Store inventory items in organization_inventory
    if (scanResult.inventory && scanResult.inventory.length > 0) {
      const inventoryInserts = scanResult.inventory
        .filter(item => item.confidence > 0.6) // Only store high-confidence items
        .map(item => ({
          organization_id: organizationId,
          item_type: item.category,
          name: item.name,
          brand: item.brand || null,
          model: item.model || null,
          condition: item.condition || 'good',
          quantity: item.quantity || 1,
          image_id: imageId,
          submitted_by: userId,
          ai_extracted: true,
          confidence_score: item.confidence
        }));

      if (inventoryInserts.length > 0) {
        await supabase
          .from('organization_inventory')
          .insert(inventoryInserts);
      }
    }

    // Update image with AI analysis
    await supabase
      .from('organization_images')
      .update({
        ai_scanned: true,
        ai_scan_date: new Date().toISOString(),
        ai_description: scanResult.description,
        ai_confidence: scanResult.confidence
      })
      .eq('id', imageId);

    return new Response(
      JSON.stringify({
        success: true,
        tags: scanResult.tags,
        inventory: scanResult.inventory,
        description: scanResult.description,
        confidence: scanResult.confidence
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Scan error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

