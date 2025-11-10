/**
 * SMART AI WORK PHOTO ANALYZER - Uses EXISTING image_tags table
 * 
 * Analyzes work photos to:
 * 1. Identify products visible (brands, part numbers)
 * 2. Save as image_tags with BUY links (Amazon, RockAuto)
 * 3. Estimate labor from VISUAL work assessment
 * 4. Makes timeline popup SHOPPABLE and USEFUL
 * 
 * Cost: $0.05 per image
 * Value: Creates buy buttons in timeline, doom-scrollable product catalog
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const openaiKey = Deno.env.get('OPENAI_API_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  try {
    const { image_url, image_id, organization_id } = await req.json();
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get image details first
    const { data: imageData } = await supabase
      .from('organization_images')
      .select('id, taken_at, timeline_event_id')
      .eq('id', image_id)
      .single();
    
    if (!imageData) throw new Error('Image not found');
    
    // AI Vision Analysis - Optimized for product identification
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are an expert automotive technician and parts specialist.

ANALYZE this work photo for SHOPPABLE PRODUCTS:

1. PRODUCTS (with EXACT details for shopping):
   - Brand name (Lincoln, 3M, Bondo, PPG, DuPont, Evercoat, etc.)
   - Product name/model
   - Part number if visible
   - Size/specification (e.g., ".035 wire", "80-grit disc", "2K clearcoat")
   - Estimated price in USD
   - Position in image (top-left, center, bottom-right, etc.)

BE SPECIFIC - exact brand names and model numbers enable shopping links.
If product partially visible, describe what you CAN see.
Identify consumables (welding wire, grinding discs, sandpaper, paint, primers, tapes, solvents).`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this work photo. Identify EVERY visible product, tool, and material that users could BUY.

Return JSON:
{
  "products": [
    {
      "brand": "3M",
      "name": "Scotch-Brite Surface Conditioning Disc",
      "part_number": "48011276189",
      "size": "4.5 inch diameter",
      "estimated_price": 15,
      "confidence": 90,
      "position": "center-right, visible on grinder",
      "x_percent": 65,
      "y_percent": 45
    }
  ],
  "work_type": "bodywork",
  "complexity": "moderate",
  "estimated_hours": 3
}`
              },
              {
                type: 'image_url',
                image_url: { url: image_url }
              }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1500
      })
    });
    
    const result = await response.json();
    
    if (!result.choices || !result.choices[0]) {
      throw new Error('OpenAI error: ' + JSON.stringify(result.error || result));
    }
    
    const analysis = JSON.parse(result.choices[0].message.content);
    
    let tagsSaved = 0;
    let shoppableCreated = 0;
    
    // Save products as IMAGE TAGS (use existing system!)
    if (analysis.products && analysis.products.length > 0) {
      for (const product of analysis.products) {
        const amazonUrl = `https://amazon.com/s?k=${encodeURIComponent(`${product.brand} ${product.name} ${product.part_number || ''}`)}`;
        const rockautoUrl = product.part_number ? `https://www.rockauto.com/en/catalog/?s=${product.part_number}` : null;
        
        const { error } = await supabase
          .from('image_tags')
          .insert({
            image_url: image_url,
            vehicle_id: null, // Org image, not vehicle
            tag_name: `${product.brand} ${product.name}`.trim(),
            tag_type: 'part',
            source_type: 'ai',
            x_position: product.x_percent || 50,
            y_position: product.y_percent || 50,
            width: 15,
            height: 15,
            confidence: product.confidence || 80,
            automated_confidence: product.confidence / 100,
            verified: false,
            validation_status: 'pending',
            is_shoppable: true,
            oem_part_number: product.part_number,
            part_description: product.size,
            lowest_price_cents: Math.round((product.estimated_price || 0) * 100),
            affiliate_links: JSON.stringify([
              { provider: 'amazon', url: amazonUrl },
              ...(rockautoUrl ? [{ provider: 'rockauto', url: rockautoUrl }] : [])
            ]),
            metadata: {
              ai_detected: true,
              brand: product.brand,
              position_description: product.position,
              ai_model: 'gpt-4o',
              detected_at: new Date().toISOString()
            }
          });
        
        if (!error) {
          tagsSaved++;
          shoppableCreated++;
        }
      }
    }
    
    // Save work assessment
    if (imageData.timeline_event_id) {
      await supabase
        .from('business_timeline_events')
        .update({
          labor_hours: analysis.estimated_hours,
          metadata: {
            ai_work_type: analysis.work_type,
            ai_complexity: analysis.complexity,
            ai_products_count: analysis.products?.length || 0,
            ai_analyzed_at: new Date().toISOString()
          }
        })
        .eq('id', imageData.timeline_event_id);
    }
    
    return new Response(JSON.stringify({
      success: true,
      analysis: analysis,
      tags_saved: tagsSaved,
      shoppable_links_created: shoppableCreated,
      message: `${tagsSaved} products tagged with buy links!`
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

