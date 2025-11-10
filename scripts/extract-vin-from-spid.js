#!/usr/bin/env node

/**
 * Extract VIN from SPID sheet image using OpenAI Vision
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!openaiKey) {
  console.error('Error: OPENAI_API_KEY environment variable required');
  process.exit(1);
}

const imageUrl = "https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/vehicles/9a8aaf17-ddb1-49a2-9b0a-1352807e7a06/dropbox/1762095664426_4gzz79qpdl3.jpg";

console.log('🔍 Analyzing SPID sheet for VIN...\n');

try {
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
          content: `You are a GM vehicle identification expert specializing in reading SPID sheets and VIN numbers.

SPID sheets typically show:
- VIN on the top line
- RPO codes below
- Paint codes
- Build information

A VIN is EXACTLY 17 characters and follows this format:
- Positions 1-3: World Manufacturer Identifier (e.g., 1GC for Chevrolet trucks)
- Position 4-8: Vehicle attributes
- Position 9: Check digit
- Position 10: Model year (e.g., S = 1978)
- Position 11: Assembly plant
- Positions 12-17: Sequential number

For a 1978 Chev Cheyenne C10, the VIN should start with something like: 1GC, CCE, CCS, or similar.

Extract the complete 17-character VIN from this image. Look very carefully at ALL text in the image, including:
- Top of the SPID label
- Any stamped/embossed numbers
- Handwritten notes
- Partial VINs that might be cut off

Return your response as JSON:
{
  "vin": "17-character VIN or null",
  "confidence": number (0-100),
  "notes": "explanation of what you see"
}`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract the VIN from this 1978 Chevrolet C10 SPID sheet. Look at EVERY visible character, including partially visible text at edges.'
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
      max_tokens: 500,
      response_format: { type: 'json_object' }
    })
  });

  const data = await response.json();
  
  if (data.error) {
    console.error('❌ OpenAI API error:', data.error.message);
    process.exit(1);
  }

  const result = JSON.parse(data.choices[0].message.content);
  
  console.log('📋 Results:');
  console.log('===========');
  console.log(`VIN: ${result.vin || 'NOT FOUND'}`);
  console.log(`Confidence: ${result.confidence}%`);
  console.log(`Notes: ${result.notes}`);
  
  if (result.vin && result.vin.length === 17) {
    console.log('\n✅ Valid VIN found!');
    console.log(`\nTo update the vehicle, run:`);
    console.log(`UPDATE vehicles SET vin = '${result.vin}' WHERE id = '9a8aaf17-ddb1-49a2-9b0a-1352807e7a06';`);
  } else {
    console.log('\n⚠️  VIN not found or incomplete');
    console.log('The VIN may be cut off in the photo or not visible on this SPID sheet.');
  }

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

