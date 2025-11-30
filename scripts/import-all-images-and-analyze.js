import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const VEHICLE_ID = '1fe31397-4f41-490f-87a2-b8dc44cb7c09';

// All image URLs from ClassicCars listing
const allImageUrls = [
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826926-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826927-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826928-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826929-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826930-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826933-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826951-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826952-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826953-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826954-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826955-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826956-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826957-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826965-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826966-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826967-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826976-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826977-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827053-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827030-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827031-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827032-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827033-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827042-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827010-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827011-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827051-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827052-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827099-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827034-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827008-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827054-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827059-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827064-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827065-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827076-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827077-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827078-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827002-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827003-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827004-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827005-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827006-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827007-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827000-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826978-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54826979-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827001-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54827029-1977-chevrolet-blazer-thumb.jpg',
  'https://photos.classiccars.com/cc-temp/listing/198/5175/54850008-1977-chevrolet-blazer-thumb.jpg'
];

function getFullSizeUrl(thumbUrl) {
  return thumbUrl.replace('-thumb.jpg', '.jpg');
}

async function importAndAnalyzeAll() {
  console.log('🚀 Importing ALL images with AI analysis and VIN extraction...\n');
  console.log(`Vehicle ID: ${VEHICLE_ID}`);
  console.log(`Total images: ${allImageUrls.length}\n`);

  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users[0]?.id;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.error('❌ OPENAI_API_KEY not found');
    return;
  }

  let imported = 0;
  let analyzed = 0;
  let totalConditionScore = 0;
  let extractedVIN = null;
  let vinConfidence = 0;
  let vinImageIndex = null;

  // Check existing images
  const { data: existing } = await supabase
    .from('vehicle_images')
    .select('source_url')
    .eq('vehicle_id', VEHICLE_ID);

  const existingUrls = new Set(existing?.map(img => img.source_url) || []);

  for (let i = 0; i < allImageUrls.length; i++) {
    const thumbUrl = allImageUrls[i];
    const fullUrl = getFullSizeUrl(thumbUrl);

    // Skip if already imported
    if (existingUrls.has(fullUrl) || existingUrls.has(thumbUrl)) {
      console.log(`[${i + 1}/${allImageUrls.length}] ⏭️  Already imported, skipping...`);
      continue;
    }

    try {
      console.log(`[${i + 1}/${allImageUrls.length}] Processing: ${fullUrl.substring(0, 60)}...`);

      // Download image
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
          'Accept': 'image/*',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        // Try thumbnail
        const thumbResponse = await fetch(thumbUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
            'Accept': 'image/*',
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!thumbResponse.ok) {
          console.log(`  ❌ Download failed (${response.status})`);
          continue;
        }

        const imageBuffer = await thumbResponse.arrayBuffer();
        var imageBytes = new Uint8Array(imageBuffer);
        var sourceUrl = thumbUrl;
      } else {
        const imageBuffer = await response.arrayBuffer();
        var imageBytes = new Uint8Array(imageBuffer);
        var sourceUrl = fullUrl;
      }

      // Convert to base64 for AI
      const base64Image = btoa(String.fromCharCode(...imageBytes.slice(0, Math.min(imageBytes.length, 1000000))));

      // AI Analysis: Condition scoring
      const conditionAnalysis = await analyzeCondition(base64Image, openaiKey);
      if (conditionAnalysis) {
        totalConditionScore += conditionAnalysis.condition_score || 0;
        analyzed++;
      }

      // AI Analysis: VIN extraction
      if (!extractedVIN || vinConfidence < 90) {
        const vinResult = await extractVINFromImage(base64Image, openaiKey);
        if (vinResult && vinResult.vin && vinResult.confidence > vinConfidence) {
          extractedVIN = vinResult.vin;
          vinConfidence = vinResult.confidence;
          vinImageIndex = i + 1;
          console.log(`  🔍 VIN FOUND: ${extractedVIN} (confidence: ${vinConfidence}%)`);
        }
      }

      // Upload to storage
      const timestamp = Date.now();
      const filename = `classiccars_${timestamp}_${i}.jpg`;
      const storagePath = `${VEHICLE_ID}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from('vehicle-images')
        .upload(storagePath, imageBytes, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.log(`  ❌ Upload failed: ${uploadError.message}`);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('vehicle-images')
        .getPublicUrl(storagePath);

      // Create vehicle_images record
      const { error: imageError } = await supabase
        .from('vehicle_images')
        .insert({
          vehicle_id: VEHICLE_ID,
          image_url: publicUrl,
          user_id: userId,
          source: 'classiccars_com',
          category: 'exterior',
          imported_by: userId,
          source_url: sourceUrl,
          is_primary: i === 0
        });

      if (imageError) {
        console.log(`  ❌ DB insert failed: ${imageError.message}`);
        continue;
      }

      console.log(`  ✅ Imported + Analyzed (Condition: ${conditionAnalysis?.condition_score || 'N/A'}/10)`);
      imported++;

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  // Update vehicle with VIN if found
  if (extractedVIN && vinConfidence >= 70) {
    console.log(`\n✅ Updating vehicle with extracted VIN: ${extractedVIN}`);
    await supabase
      .from('vehicles')
      .update({ vin: extractedVIN })
      .eq('id', VEHICLE_ID);
  }

  // Update condition score
  const avgScore = analyzed > 0 ? Math.round(totalConditionScore / analyzed) : 0;
  if (avgScore > 0) {
    await supabase
      .from('vehicles')
      .update({ condition_rating: avgScore })
      .eq('id', VEHICLE_ID);
  }

  console.log(`\n✅ Complete!`);
  console.log(`  Images imported: ${imported}`);
  console.log(`  Images analyzed: ${analyzed}`);
  console.log(`  Average condition score: ${avgScore}/10`);
  if (extractedVIN) {
    console.log(`  VIN extracted: ${extractedVIN} (from image ${vinImageIndex}, confidence: ${vinConfidence}%)`);
  }
  console.log(`\n🔗 Profile: https://n-zero.dev/vehicle/${VEHICLE_ID}\n`);
}

async function analyzeCondition(base64Image, apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this vehicle image and provide a condition score from 1-10. Rate based on paint quality, body condition, visible wear. Return JSON: {"condition_score": 1-10, "confidence": 0-100}'
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}` }
            }
          ]
        }],
        max_tokens: 200,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) return null;

    const result = JSON.parse(content);
    return {
      condition_score: result.condition_score || 0,
      confidence: result.confidence || 0
    };
  } catch (e) {
    return null;
  }
}

async function extractVINFromImage(base64Image, apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this vehicle image for a VIN tag/plate. VINs are 17 characters, found on dashboard, door jamb, firewall, or frame. Return JSON: {"has_vin_tag": boolean, "vin": "17-char VIN or null", "confidence": 0-100, "location": "dashboard|door_jamb|firewall|frame|unknown"}`
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'high' }
            }
          ]
        }],
        max_tokens: 300,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) return null;

    const result = JSON.parse(content);
    if (result.has_vin_tag && result.vin && result.vin.length === 17 && !/[IOQ]/.test(result.vin.toUpperCase())) {
      return {
        vin: result.vin.toUpperCase(),
        confidence: result.confidence || 0
      };
    }
    return null;
  } catch (e) {
    return null;
  }
}

importAndAnalyzeAll().catch(console.error);

