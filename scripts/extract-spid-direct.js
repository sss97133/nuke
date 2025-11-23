#!/usr/bin/env node
/**
 * Direct SPID extraction using Claude Vision API
 */

import 'dotenv/config';

const anthropicKey = process.env.NUKE_CLAUDE_API || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const imageUrl = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/3f1791fe-4fe2-4994-b6fe-b137ffa57370/eafcc713-3f9a-4535-9cb2-764c76ad90f7.jpeg';

console.log('Extracting SPID data from image using Claude...\n');
console.log('Image:', imageUrl.substring(0, 80) + '...\n');

// Download image and convert to base64
console.log('Downloading image...');
const imageResponse = await fetch(imageUrl);
const imageBuffer = await imageResponse.arrayBuffer();
const base64Image = Buffer.from(imageBuffer).toString('base64');
const mediaType = 'image/jpeg';

console.log('Calling Claude Vision API...\n');

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': anthropicKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-3-opus-20240229',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Image
            }
          },
          {
            type: 'text',
            text: `You are a GM SPID (Service Parts Identification) sheet expert. Extract ALL data from this label.

SPID sheets contain:
- VIN (17-character alphanumeric)
- MODEL CODE (e.g., CCE2436, CKE1418) - CRITICAL for decoding year/model/cab
- Build date and sequence number
- Paint codes (exterior and interior)
- RPO codes (ALL 3-character codes like G80, KC4, Z84, LS4, M40)

Extract EVERY code you see. The MODEL CODE often appears on a line like "MODEL: CCE2436*" or "MDL: CKE1418Z".

Extract EVERY piece of data including wheelbase, tire sizes, GVW, and descriptions.

Return ONLY valid JSON in this exact format:
{
  "is_spid_sheet": true or false,
  "confidence": 0-100,
  "extracted_data": {
    "vin": "17-character VIN",
    "model_code": "model code like CCE2436",
    "wheelbase": "inches like 1645",
    "sequence_number": "sequence number",
    "build_date": "date if shown",
    "paint_code_exterior": "code",
    "paint_code_exterior_name": "color name like Spring Green",
    "paint_code_interior": "code",
    "paint_code_interior_name": "trim name",
    "rpo_codes_with_descriptions": [
      {"code": "Z84", "description": "Silverado Equipment"},
      {"code": "M40", "description": "Turbo Hydra-Matic Transmission"}
    ],
    "engine_description": "full engine description",
    "transmission_description": "full transmission description",
    "axle_ratio": "ratio",
    "axle_description": "full axle description",
    "tire_front": "tire size",
    "tire_rear": "tire size",
    "gvw_rating": "GVW if shown",
    "special_packages": ["array of special packages like Camper Spec"]
  },
  "raw_text": "all visible text"
}`
          }
        ]
      }
    ]
  })
});

const data = await response.json();

if (data.error) {
  console.error('Claude error:', data.error);
  process.exit(1);
}

// Claude returns content in a different format
const textContent = data.content.find(c => c.type === 'text');
if (!textContent) {
  console.error('No text content in response');
  process.exit(1);
}

// Extract JSON from response
const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  console.error('No JSON found in response');
  console.log('Response:', textContent.text);
  process.exit(1);
}

const result = JSON.parse(jsonMatch[0]);

console.log('='.repeat(60));
console.log('SPID EXTRACTION RESULTS');
console.log('='.repeat(60));
console.log();
console.log('Is SPID Sheet:', result.is_spid_sheet);
console.log('Confidence:', result.confidence + '%');
console.log();

if (result.is_spid_sheet && result.extracted_data) {
  const d = result.extracted_data;
  
  console.log('IDENTIFICATION');
  console.log('─'.repeat(60));
  console.log('VIN:', d.vin || 'Not found');
  console.log('Model Code:', d.model_code || 'Not found');
  console.log('Build Date:', d.build_date || 'Not found');
  console.log('Sequence:', d.sequence_number || 'Not found');
  console.log();
  
  console.log('PAINT CODES');
  console.log('─'.repeat(60));
  console.log('Exterior:', d.paint_code_exterior || 'Not found');
  console.log('Interior:', d.paint_code_interior || 'Not found');
  console.log();
  
  console.log('RPO CODES (' + (d.rpo_codes?.length || 0) + ' found)');
  console.log('─'.repeat(60));
  if (d.rpo_codes && d.rpo_codes.length > 0) {
    console.log(d.rpo_codes.join(', '));
  } else {
    console.log('None found');
  }
  console.log();
  
  console.log('DRIVETRAIN');
  console.log('─'.repeat(60));
  console.log('Engine Code:', d.engine_code || 'Not found');
  console.log('Trans Code:', d.transmission_code || 'Not found');
  console.log('Axle Ratio:', d.axle_ratio || 'Not found');
  console.log();
  
  console.log('RAW TEXT');
  console.log('─'.repeat(60));
  console.log(result.raw_text || 'None');
  console.log();
  
  // Decode model code if present
  if (d.model_code) {
    console.log('MODEL CODE DECODED');
    console.log('─'.repeat(60));
    console.log('Full Code:', d.model_code);
    
    const seriesCode = d.model_code.substring(3, 5);
    const series = seriesCode === '14' ? 'C10/K10' :
                   seriesCode === '24' ? 'C20/K20' :
                   seriesCode === '34' ? 'C30/K30' : 'Unknown';
    console.log('Series:', series, '(from digits 4-5:', seriesCode + ')');
    
    const cabCode = d.model_code.charAt(5);
    const cab = cabCode === '3' ? 'Crew Cab (3+3)' :
                cabCode === '4' ? 'Regular Cab' :
                cabCode === '5' ? 'Extended Cab' : 'Unknown';
    console.log('Cab:', cab, '(from digit 6:', cabCode + ')');
    
    const yearCode = d.model_code.charAt(2);
    console.log('Year Code:', yearCode, '(need lookup table to decode)');
    console.log();
  }
  
} else {
  console.log('Not a SPID sheet or confidence too low');
}

console.log('='.repeat(60));

