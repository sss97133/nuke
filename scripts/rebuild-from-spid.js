#!/usr/bin/env node

/**
 * REBUILD VEHICLE PROFILE FROM SPID SHEET
 * 
 * SPID sheet is 100% truth of origin - use it as foundation
 */

import { createClient } from '@supabase/supabase-js';

const vehicleId = '9a8aaf17-ddb1-49a2-9b0a-1352807e7a06';
const spidImageUrl = "https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/vehicles/9a8aaf17-ddb1-49a2-9b0a-1352807e7a06/dropbox/1762095664426_4gzz79qpdl3.jpg";

console.log('🔧 REBUILDING VEHICLE PROFILE FROM SPID SHEET');
console.log('==============================================\n');

// Get OpenAI key from Supabase secrets
const { execSync } = await import('child_process');
let openaiKey;
try {
  openaiKey = execSync('supabase secrets get OPENAI_API_KEY 2>/dev/null', { encoding: 'utf-8' }).trim().split('\n').pop();
} catch (e) {
  console.error('❌ Could not get OPENAI_API_KEY from Supabase secrets');
  process.exit(1);
}

console.log('📸 Analyzing SPID sheet with high-detail OCR...\n');

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
          content: `You are a GM SPID sheet expert. Extract EVERY piece of data from this Service Parts Identification label.

SPID sheets contain:
1. VIN (17 characters) - Usually starts with 1GC, CCE, CCS for Chevy trucks
2. MODEL CODE (e.g., CE1418Z = 1984 C10, CKE1418 = 1988 C1500)
3. BUILD DATE and SEQUENCE
4. RPO CODES (Regular Production Options) - 3-character codes
5. PAINT CODES

CRITICAL: The MODEL CODE tells us the YEAR. Examples:
- CE14 = 1973-1980 C10
- CK14 = 1981-1987 C/K series  
- CKE14 = 1988-1991 C1500
- First 1-2 letters indicate series, middle 2 digits indicate wheelbase (14=117", 15=131", etc.)

Read EVERY character on the label, including:
- Top line with VIN
- MODEL= line
- All RPO codes
- Paint codes
- Any handwritten or stamped numbers

Return comprehensive JSON with ALL extracted data.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract EVERY piece of data from this SPID sheet. Read every character carefully, especially the VIN and MODEL lines. This is a Chevrolet C10 pickup truck.'
            },
            {
              type: 'image_url',
              image_url: {
                url: spidImageUrl,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    })
  });

  const data = await response.json();
  
  if (data.error) {
    console.error('❌ OpenAI API error:', data.error.message);
    process.exit(1);
  }

  const spidData = JSON.parse(data.choices[0].message.content);
  
  console.log('📋 SPID SHEET DATA EXTRACTED:');
  console.log('==============================');
  console.log(JSON.stringify(spidData, null, 2));
  console.log('\n');

  // Decode year from VIN or MODEL code
  let year = null;
  let vin = spidData.vin || spidData.extracted_data?.vin;
  let modelCode = spidData.model_code || spidData.model || spidData.extracted_data?.model;
  
  if (vin && vin.length === 17) {
    // Position 10 in VIN is year code
    const yearCodes = {
      'A': 1980, 'B': 1981, 'C': 1982, 'D': 1983, 'E': 1984,
      'F': 1985, 'G': 1986, 'H': 1987, 'J': 1988, 'K': 1989,
      'L': 1990, 'M': 1991, 'N': 1992, 'P': 1993, 'R': 1994,
      'S': 1995, 'T': 1996, 'V': 1997, 'W': 1998, 'X': 1999,
      'Y': 2000, '1': 2001, '2': 2002, '3': 2003, '4': 2004,
      '5': 2005, '6': 2006, '7': 2007, '8': 2008, '9': 2009
    };
    const yearChar = vin[9];
    year = yearCodes[yearChar];
    console.log(`🗓️  Year decoded from VIN position 10 ('${yearChar}'): ${year}`);
  }
  
  // Decode model code
  let series = 'C10';
  if (modelCode) {
    if (modelCode.includes('10') || modelCode.includes('14')) {
      series = 'C10';
    } else if (modelCode.includes('15')) {
      series = 'C15';
    } else if (modelCode.includes('20')) {
      series = 'C20';
    } else if (modelCode.includes('30')) {
      series = 'C30';
    }
    console.log(`🚛 Series decoded from MODEL ('${modelCode}'): ${series}`);
  }

  // Decode RPO codes
  const rpoCodes = spidData.rpo_codes || spidData.extracted_data?.rpo_codes || [];
  console.log(`\n🔧 RPO CODES FOUND: ${rpoCodes.length}`);
  
  const rpoDescriptions = {
    'LB9': '5.7L V8 350 Engine',
    'MX0': '3-Speed Manual Transmission',
    'GU4': '3.08 Rear Axle Ratio',
    'G80': 'Locking Rear Differential',
    'ZQ8': 'Sport Suspension Package',
    'C60': 'Air Conditioning',
    'J50': 'Power Brakes',
    'N33': 'Tilt Steering Wheel',
    'N40': 'Power Steering',
    'A01': 'Tinted Glass',
    'U69': 'Radio AM/FM',
    'B30': 'Floor Mats',
    'YE9': 'California Emissions'
  };
  
  rpoCodes.forEach(code => {
    const desc = rpoDescriptions[code] || 'Unknown option';
    console.log(`  ${code}: ${desc}`);
  });

  // Build update data
  const updates = {
    year: year || 1978,
    make: 'Chevrolet',
    model: series,
    trim: 'Cheyenne',
    vin: vin,
    engine: spidData.engine || spidData.extracted_data?.engine_code || 'LB9 (5.7L V8)',
    transmission: spidData.transmission || spidData.extracted_data?.transmission_code || 'MX0 (3-Speed Manual)',
    paint_code: spidData.paint_code || spidData.extracted_data?.paint_code_exterior,
    data_source: 'spid_sheet',
    spid_data: {
      ...spidData,
      rpo_codes: rpoCodes,
      scanned_at: new Date().toISOString(),
      image_url: spidImageUrl
    }
  };

  console.log('\n✅ VEHICLE PROFILE UPDATE:');
  console.log('===========================');
  console.log(JSON.stringify(updates, null, 2));
  
  console.log('\n📝 SQL UPDATE QUERY:');
  console.log('====================');
  console.log(`UPDATE vehicles SET`);
  if (year) console.log(`  year = ${year},`);
  console.log(`  make = 'Chevrolet',`);
  console.log(`  model = '${series}',`);
  console.log(`  trim = 'Cheyenne',`);
  if (vin) console.log(`  vin = '${vin}',`);
  console.log(`  updated_at = NOW()`);
  console.log(`WHERE id = '${vehicleId}';`);
  
  console.log('\n🎯 Ready to update! Review the data above.');

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

