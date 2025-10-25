/**
 * On-Demand Part Identification
 * 
 * User clicks anywhere on vehicle image → AI identifies what part it is
 * → Looks up in catalog → Returns pricing + suppliers
 * 
 * Like Google Lens but for vehicle parts with instant shopping.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  try {
    const { vehicle_id, image_id, image_url, x_position, y_position } = await req.json();

    // STEP 1: Use dimensional matching first (fast)
    const dimensionalMatch = await findPartByDimensions(x_position, y_position, image_url);
    
    if (dimensionalMatch) {
      // Found via dimensional mapping - instant response
      const catalogData = await lookupInCatalog(dimensionalMatch.part_name, vehicle_id);
      
      return new Response(JSON.stringify({
        part_name: dimensionalMatch.part_name,
        oem_part_number: catalogData.oem_part_number,
        suppliers: catalogData.suppliers,
        lowest_price_cents: catalogData.lowest_price_cents,
        highest_price_cents: catalogData.highest_price_cents,
        method: 'dimensional_match',
        confidence: 95
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // STEP 2: Use AI vision to identify part (slower but works for any part)
    const aiIdentification = await identifyPartWithAI(image_url, x_position, y_position);
    
    if (aiIdentification) {
      const catalogData = await lookupInCatalog(aiIdentification.part_name, vehicle_id);
      
      return new Response(JSON.stringify({
        part_name: aiIdentification.part_name,
        oem_part_number: catalogData.oem_part_number,
        suppliers: catalogData.suppliers,
        lowest_price_cents: catalogData.lowest_price_cents,
        highest_price_cents: catalogData.highest_price_cents,
        method: 'ai_vision',
        confidence: aiIdentification.confidence
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // No part identified
    return new Response(JSON.stringify({
      error: 'No part identified at these coordinates'
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Part identification error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// ============================================================================
// DIMENSIONAL MATCHING (Fast - uses pre-mapped locations)
// ============================================================================

async function findPartByDimensions(x: number, y: number, imageUrl: string): Promise<any> {
  // Determine view angle from image URL or area
  const viewAngle = determineViewAngle(imageUrl);
  
  // Query dimensional map
  const { data: matches } = await supabase
    .from('vehicle_part_locations')
    .select('*')
    .eq('view_angle', viewAngle)
    .lte('x_position_min', x)
    .gte('x_position_max', x)
    .lte('y_position_min', y)
    .gte('y_position_max', y);

  if (matches && matches.length > 0) {
    // Return best match (smallest bounding box = most specific)
    const sorted = matches.sort((a, b) => {
      const areaA = (a.x_position_max - a.x_position_min) * (a.y_position_max - a.y_position_min);
      const areaB = (b.x_position_max - b.x_position_min) * (b.y_position_max - b.y_position_min);
      return areaA - areaB;
    });
    
    return sorted[0];
  }

  return null;
}

function determineViewAngle(imageUrl: string): string {
  const url = imageUrl.toLowerCase();
  
  if (url.includes('front')) return 'front';
  if (url.includes('rear') || url.includes('back')) return 'rear';
  if (url.includes('side') || url.includes('door')) return 'side';
  if (url.includes('interior') || url.includes('dash')) return 'interior_dashboard';
  if (url.includes('engine') || url.includes('motor')) return 'engine_bay';
  if (url.includes('under')) return 'undercarriage';
  
  // Default: assume front view for exterior shots
  return 'front';
}

// ============================================================================
// AI VISION IDENTIFICATION (Slower - works for any part)
// ============================================================================

async function identifyPartWithAI(imageUrl: string, x: number, y: number): Promise<any> {
  if (!OPENAI_API_KEY) {
    console.warn('OpenAI API key not configured');
    return null;
  }

  const prompt = `You are an expert automotive parts identifier. A user clicked at position ${x}%, ${y}% on this vehicle image. 

Identify what automotive part is at that location. Be specific.

Respond ONLY with JSON:
{
  "part_name": "Master Cylinder",
  "part_category": "brake_system",
  "oem_typical_format": "GM-MC-XXXX or similar",
  "confidence": 85
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 300
      })
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (content) {
      const parsed = JSON.parse(content);
      return parsed;
    }

  } catch (err) {
    console.error('AI vision error:', err);
  }

  return null;
}

// ============================================================================
// CATALOG LOOKUP (Gets pricing + suppliers for identified part)
// ============================================================================

async function lookupInCatalog(partName: string, vehicleId: string): Promise<any> {
  // Get vehicle year/make/model for fitment
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('year, make, model')
    .eq('id', vehicleId)
    .single();

  // Search catalog for this part
  const { data: catalogParts } = await supabase
    .from('part_catalog')
    .select('*')
    .ilike('part_name', `%${partName}%`)
    .or(`${vehicle?.year}.gte.year_start,${vehicle?.year}.lte.year_end`);

  if (catalogParts && catalogParts.length > 0) {
    const part = catalogParts[0];
    return {
      oem_part_number: part.oem_part_number,
      suppliers: part.suppliers || [],
      lowest_price_cents: part.price_cents || 0,
      highest_price_cents: part.price_cents || 0
    };
  }

  // Not in catalog - use generic pricing from common suppliers
  return await getGenericPricing(partName);
}

async function getGenericPricing(partName: string): Promise<any> {
  // Get supplier list
  const { data: suppliers } = await supabase
    .from('part_suppliers')
    .select('*')
    .limit(5);

  // Estimate pricing based on part type
  const priceEstimate = estimatePrice(partName);

  return {
    oem_part_number: `GENERIC-${partName.replace(/\s+/g, '-').toUpperCase()}`,
    suppliers: suppliers?.map(s => ({
      supplier_id: s.id,
      supplier_name: s.name,
      price_cents: Math.round(priceEstimate * (0.8 + Math.random() * 0.4)),  // ±20% variance
      in_stock: true,
      url: s.base_url,
      shipping_days: s.avg_shipping_days
    })) || [],
    lowest_price_cents: Math.round(priceEstimate * 0.8),
    highest_price_cents: Math.round(priceEstimate * 1.2)
  };
}

function estimatePrice(partName: string): number {
  const name = partName.toLowerCase();
  
  // Common automotive parts pricing (in cents)
  if (name.includes('master cylinder')) return 8500;  // $85
  if (name.includes('brake')) return 4500;  // $45
  if (name.includes('headlight')) return 5000;  // $50
  if (name.includes('bumper')) return 9000;  // $90
  if (name.includes('grille')) return 15000;  // $150
  if (name.includes('fender')) return 18000;  // $180
  if (name.includes('hood')) return 25000;  // $250
  if (name.includes('door')) return 30000;  // $300
  if (name.includes('carburetor')) return 35000;  // $350
  if (name.includes('alternator')) return 12000;  // $120
  if (name.includes('battery')) return 15000;  // $150
  if (name.includes('radiator')) return 20000;  // $200
  if (name.includes('wheel')) return 15000;  // $150
  if (name.includes('tire')) return 18000;  // $180
  
  // Default estimate
  return 10000;  // $100
}

