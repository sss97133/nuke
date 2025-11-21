/**
 * Extract Parts and Brands from Bring a Trailer Listing
 * 
 * Uses AI to extract part names, brands, and context from BAT listing descriptions.
 * Links extracted data to vehicle and optionally to image tags.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractRequest {
  vehicleId: string;
  batListingUrl: string;
  listingDescription?: string; // Optional: if not provided, will fetch from URL
  linkToImageTags?: boolean; // Auto-link to matching image tags
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          persistSession: false,
          detectSessionInUrl: false
        }
      }
    );

    const { vehicleId, batListingUrl, listingDescription, linkToImageTags = true }: ExtractRequest = await req.json();

    if (!vehicleId || !batListingUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: vehicleId, batListingUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`🔍 Extracting parts/brands from BAT listing: ${batListingUrl}`);

    // Get vehicle context
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('year, make, model')
      .eq('id', vehicleId)
      .single();

    if (!vehicle) {
      return new Response(
        JSON.stringify({ error: 'Vehicle not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch listing HTML if description not provided
    let description = listingDescription;
    if (!description) {
      try {
        // Fetch BAT listing HTML directly
        const response = await fetch(batListingUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch BAT listing: ${response.status}`);
        }
        
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        
        // Extract description using same logic as scrape-vehicle
        const descElement = doc.querySelector('.post-content, .listing-description, article, .post-body');
        description = descElement?.textContent?.trim() || '';
        
        // Fallback: get body text if no description element found
        if (!description || description.length < 100) {
          const bodyText = doc.body?.textContent || '';
          description = bodyText.trim().substring(0, 10000);
        }
      } catch (err) {
        console.error('Error fetching BAT listing:', err);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch listing description', details: String(err) }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!description || description.length < 100) {
      return new Response(
        JSON.stringify({ error: 'Listing description too short or missing' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract parts and brands using OpenAI
    const extracted = await extractPartsAndBrands(description, vehicle);

    if (!extracted || extracted.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          extracted: [],
          message: 'No parts/brands found in listing' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Store extracted parts
    const storedParts = [];
    for (const part of extracted) {
      const { data: stored, error: insertError } = await supabase
        .from('bat_listing_parts')
        .upsert({
          vehicle_id: vehicleId,
          bat_listing_url: batListingUrl,
          part_name: part.part_name,
          brand_name: part.brand_name || null,
          part_number: part.part_number || null,
          description: part.description || null,
          context_text: part.context_text || null,
          confidence_score: part.confidence || 80
        }, {
          onConflict: 'vehicle_id,bat_listing_url,part_name,brand_name'
        })
        .select()
        .single();

      if (!insertError && stored) {
        storedParts.push(stored);

        // Link to matching image tags if requested
        if (linkToImageTags) {
          await linkToImageTags(stored, vehicleId, supabase);
        }
      }
    }

    // Update vehicle with BAT listing URL if not set
    await supabase
      .from('vehicles')
      .update({ 
        discovery_url: batListingUrl,
        discovery_source: 'bat_listing',
        bat_auction_url: batListingUrl
      })
      .eq('id', vehicleId)
      .is('discovery_url', null);

    return new Response(
      JSON.stringify({
        success: true,
        extracted: storedParts,
        count: storedParts.length,
        message: `Extracted ${storedParts.length} parts/brands from BAT listing`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error extracting BAT parts/brands:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function extractPartsAndBrands(description: string, vehicle: any): Promise<any[]> {
  const openaiKey = Deno.env.get('OPEN_AI_API_KEY');
  if (!openaiKey) {
    throw new Error('OPEN_AI_API_KEY not configured');
  }

  const vehicleName = `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert automotive parts extractor. Extract parts, brands, and modifications mentioned in Bring a Trailer listing descriptions.

Return ONLY valid JSON array with this exact schema:
[
  {
    "part_name": "string (e.g., 'shock absorber', 'brake caliper', 'exhaust system')",
    "brand_name": "string or null (e.g., 'Bilstein', 'Brembo', 'Borla')",
    "part_number": "string or null (if mentioned)",
    "description": "string (brief description of the part/modification)",
    "context_text": "string (exact quote from listing mentioning this part)",
    "confidence": number 0-100
  }
]

Focus on:
- Suspension components (shocks, struts, springs, sway bars)
- Brake components (calipers, rotors, pads, lines)
- Engine modifications (intake, exhaust, headers, camshafts)
- Interior upgrades (seats, steering wheels, audio)
- Exterior modifications (wheels, tires, body panels)
- Electrical upgrades (lights, wiring, gauges)

Extract brand names when explicitly mentioned (e.g., "Bilstein shocks", "Brembo brakes").
Include the exact context text so users can verify the source.
Be precise - only extract if you're confident the part/brand is mentioned.`
        },
        {
          role: 'user',
          content: `Extract parts and brands from this ${vehicleName} Bring a Trailer listing description:\n\n${description.substring(0, 8000)}`
        }
      ],
      max_tokens: 2000,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  // Parse JSON from response
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/```$/, '').trim();
  }

  const extracted = JSON.parse(jsonStr);
  return Array.isArray(extracted) ? extracted : [];
}

async function linkToImageTags(batPart: any, vehicleId: string, supabase: any) {
  // Find image tags that match this part name
  const { data: matchingTags } = await supabase
    .from('image_tags')
    .select('id, tag_name, image_id')
    .eq('vehicle_id', vehicleId)
    .ilike('tag_name', `%${batPart.part_name}%`);

  if (!matchingTags || matchingTags.length === 0) return;

  // Link each matching tag to the BAT part
  for (const tag of matchingTags) {
    await supabase
      .from('image_tag_bat_references')
      .upsert({
        image_tag_id: tag.id,
        bat_listing_part_id: batPart.id,
        match_confidence: 85 // High confidence if tag name matches part name
      }, {
        onConflict: 'image_tag_id,bat_listing_part_id'
      });
  }
}

