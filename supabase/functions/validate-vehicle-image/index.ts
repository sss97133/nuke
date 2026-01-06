/**
 * AI Vehicle Image Validator
 * Validates if an image actually shows the expected vehicle vs pollution/UI elements
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ValidationRequest {
  image_url: string;
  expected_vehicle?: string; // e.g. "1985 BMW M635CSI"
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  check_relevance?: boolean;
}

interface ValidationResult {
  is_vehicle_image: boolean;
  shows_expected_vehicle: boolean;
  confidence: number;
  detected_content: string[];
  reasons: string[];
  image_type: 'vehicle_exterior' | 'vehicle_interior' | 'engine_bay' | 'undercarriage' | 'documentation' | 'ui_element' | 'unrelated';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ValidationRequest = await req.json();
    const { image_url, expected_vehicle, vehicle_year, vehicle_make, vehicle_model, check_relevance } = body;

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: 'image_url is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Quick URL-based filtering first (fast rejection of obvious noise)
    const urlResult = quickUrlAnalysis(image_url);
    if (urlResult.is_obvious_noise) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            is_vehicle_image: false,
            shows_expected_vehicle: false,
            confidence: urlResult.confidence,
            detected_content: ['ui_element', 'noise'],
            reasons: [`URL pattern indicates noise: ${urlResult.reason}`],
            image_type: 'ui_element',
            validation_method: 'url_analysis'
          } as ValidationResult
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use OpenAI Vision for actual image content analysis
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const expectedVehicleDescription = expected_vehicle ||
      (vehicle_year && vehicle_make && vehicle_model
        ? `${vehicle_year} ${vehicle_make} ${vehicle_model}`
        : null);

    const prompt = buildValidationPrompt(expectedVehicleDescription, check_relevance);

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: image_url,
                  detail: 'low' // Use low detail for faster analysis
                }
              }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 500
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      throw new Error(`OpenAI Vision API error: ${errorText}`);
    }

    const aiData = await openaiResponse.json();
    const analysis = JSON.parse(aiData.choices[0].message.content);

    // Process and validate the AI response
    const validationResult: ValidationResult = {
      is_vehicle_image: analysis.is_vehicle_image || false,
      shows_expected_vehicle: analysis.shows_expected_vehicle || false,
      confidence: Math.min(Math.max(analysis.confidence || 0.5, 0), 1),
      detected_content: Array.isArray(analysis.detected_content) ? analysis.detected_content : [],
      reasons: Array.isArray(analysis.reasons) ? analysis.reasons : [],
      image_type: analysis.image_type || 'unrelated'
    };

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          ...validationResult,
          validation_method: 'ai_vision',
          expected_vehicle: expectedVehicleDescription
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Image validation error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown validation error',
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

function quickUrlAnalysis(url: string): { is_obvious_noise: boolean; confidence: number; reason: string } {
  const urlLower = url.toLowerCase();

  // Obvious noise patterns that don't need AI analysis
  const noisePatterns = [
    { pattern: /\/icons?\//i, reason: 'Icon directory path' },
    { pattern: /\/ui\//i, reason: 'UI directory path' },
    { pattern: /\/assets\/(?!vehicles?)/i, reason: 'Non-vehicle assets directory' },
    { pattern: /logo|header|footer|nav/i, reason: 'Site navigation elements' },
    { pattern: /social|share|facebook|twitter/i, reason: 'Social media elements' },
    { pattern: /avatar|profile|user/i, reason: 'User profile elements' },
    { pattern: /-\d{1,2}x\d{1,2}\./i, reason: 'Very small icon size' },
    { pattern: /placeholder|blank|empty|default\./i, reason: 'Placeholder image' },
    { pattern: /\.svg$/i, reason: 'SVG vector graphic (likely UI)' },
    { pattern: /badge|button|arrow|chevron/i, reason: 'UI component' }
  ];

  for (const { pattern, reason } of noisePatterns) {
    if (pattern.test(urlLower)) {
      return { is_obvious_noise: true, confidence: 0.9, reason };
    }
  }

  return { is_obvious_noise: false, confidence: 0.5, reason: 'Requires AI analysis' };
}

function buildValidationPrompt(expectedVehicle?: string | null, checkRelevance = true): string {
  const basePrompt = `
Analyze this image and determine if it shows a vehicle (car, truck, motorcycle) vs other content.

Return a JSON response with:
{
  "is_vehicle_image": boolean (true if image shows any vehicle),
  "shows_expected_vehicle": boolean (true if image shows the specific vehicle described below),
  "confidence": number (0.0-1.0, confidence in the analysis),
  "detected_content": string[] (what you see: ["car_exterior", "engine", "interior", "ui_element", "person", etc.]),
  "reasons": string[] (reasons for your assessment),
  "image_type": string (one of: "vehicle_exterior", "vehicle_interior", "engine_bay", "undercarriage", "documentation", "ui_element", "unrelated")
}

Focus on distinguishing between:
1. Actual vehicle photos (exterior, interior, engine bay, etc.)
2. Website UI elements (logos, buttons, navigation, etc.)
3. People, locations, or other non-vehicle content
4. Documents/paperwork related to vehicles

Be strict about vehicle relevance - only mark as vehicle_image if it clearly shows automotive content.`;

  if (expectedVehicle && checkRelevance) {
    return basePrompt + `\n\nExpected vehicle: ${expectedVehicle}
If the image shows a vehicle, determine if it matches this specific vehicle (same make, model, era, color if visible).`;
  }

  return basePrompt;
}