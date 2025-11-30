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

// Get all available API keys
const GEMINI_KEY = process.env.GOOGLE_AI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

console.log('🚨 CRITICAL: Analyzing ALL images - no exceptions\n');
console.log('Available AI providers:');
console.log(`  Gemini: ${GEMINI_KEY ? '✅' : '❌'}`);
console.log(`  OpenAI: ${OPENAI_KEY ? '✅' : '❌'}`);
console.log(`  Claude: ${ANTHROPIC_KEY ? '✅' : '❌'}\n`);

async function analyzeALLImages() {
  // Get ALL images for this vehicle
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching images:', error.message);
    return;
  }

  if (!images || images.length === 0) {
    console.log('❌ No images found');
    return;
  }

  // Find images that need analysis
  const needsAnalysis = images.filter(img => {
    const hasAnalysis = img.ai_scan_metadata?.appraiser?.primary_label;
    return !hasAnalysis;
  });

  console.log(`📊 Total images: ${images.length}`);
  console.log(`🔍 Need analysis: ${needsAnalysis.length}`);
  console.log(`✅ Already analyzed: ${images.length - needsAnalysis.length}\n`);

  if (needsAnalysis.length === 0) {
    console.log('✅ ALL images already analyzed!');
    return;
  }

  console.log('🚀 Starting analysis of ALL images...\n');

  let analyzed = 0;
  let failed = 0;
  const failedImages = [];

  for (let i = 0; i < needsAnalysis.length; i++) {
    const image = needsAnalysis[i];
    
    try {
      console.log(`[${i + 1}/${needsAnalysis.length}] Analyzing image ${image.id}...`);

      // Try all providers until one works
      let result = null;
      let providerUsed = null;

      // Try Gemini first (free)
      if (GEMINI_KEY) {
        try {
          result = await analyzeWithGemini(image.image_url, GEMINI_KEY);
          providerUsed = 'gemini';
        } catch (e) {
          console.log(`  ⚠️  Gemini failed: ${e.message}`);
        }
      }

      // Try OpenAI if Gemini failed
      if (!result && OPENAI_KEY) {
        try {
          result = await analyzeWithOpenAI(image.image_url, OPENAI_KEY);
          providerUsed = 'openai';
        } catch (e) {
          console.log(`  ⚠️  OpenAI failed: ${e.message}`);
        }
      }

      // Try Claude if both failed
      if (!result && ANTHROPIC_KEY) {
        try {
          result = await analyzeWithClaude(image.image_url, ANTHROPIC_KEY);
          providerUsed = 'claude';
        } catch (e) {
          console.log(`  ⚠️  Claude failed: ${e.message}`);
        }
      }

      if (!result) {
        console.log(`  ❌ ALL providers failed for image ${image.id}`);
        failed++;
        failedImages.push(image.id);
        continue;
      }

      // Format for ai_scan_metadata
      const angleLabels = {
        'exterior_front': 'Front View',
        'exterior_rear': 'Rear View',
        'exterior_side': 'Side View',
        'exterior_three_quarter': 'Three-Quarter View',
        'interior_front_seats': 'Interior - Front Seats',
        'interior_dashboard': 'Interior - Dashboard',
        'engine_bay': 'Engine Bay',
        'undercarriage': 'Undercarriage',
        'detail_shot': 'Detail Shot'
      };

      const descriptionParts = [];
      if (result.angle) {
        descriptionParts.push(`Angle: ${angleLabels[result.angle] || result.angle}`);
      }
      if (result.condition_score) {
        descriptionParts.push(`Condition: ${result.condition_score}/10`);
      }
      if (result.rust_severity) {
        descriptionParts.push(`Rust: ${result.rust_severity}/10`);
      }

      const contextParts = [];
      if (result.environment) {
        contextParts.push(`Environment: ${result.environment}`);
      }
      if (result.photo_quality) {
        contextParts.push(`Photo quality: ${result.photo_quality}`);
      }

      const aiScanMetadata = {
        appraiser: {
          angle: result.angle || 'exterior',
          primary_label: angleLabels[result.angle || 'exterior'] || 'Exterior View',
          description: descriptionParts.join(' • ') || 'Vehicle exterior view',
          context: contextParts.join(' | ') || 'ClassicCars.com listing photo',
          model: providerUsed || 'unknown',
          analyzed_at: new Date().toISOString(),
          condition_score: result.condition_score,
          rust_severity: result.rust_severity,
          paint_quality: result.paint_quality
        }
      };

      // Update image record
      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update({
          ai_scan_metadata: aiScanMetadata,
          ai_processing_status: 'completed'
        })
        .eq('id', image.id);

      if (updateError) {
        console.log(`  ❌ Update failed: ${updateError.message}`);
        failed++;
        failedImages.push(image.id);
      } else {
        console.log(`  ✅ Analyzed (${providerUsed}, Condition: ${result.condition_score || 'N/A'}/10)`);
        analyzed++;
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
      failedImages.push(image.id);
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`📊 FINAL RESULTS`);
  console.log(`═══════════════════════════════════════════════════════════`);
  console.log(`✅ Successfully analyzed: ${analyzed}/${needsAnalysis.length}`);
  console.log(`❌ Failed: ${failed}/${needsAnalysis.length}`);
  
  if (failedImages.length > 0) {
    console.log(`\n⚠️  Failed image IDs:`);
    failedImages.forEach(id => console.log(`   - ${id}`));
    console.log(`\n🔄 Retry failed images with:`);
    console.log(`   node scripts/retry-failed-images.js`);
  }

  console.log(`\n🔗 Profile: https://n-zero.dev/vehicle/${VEHICLE_ID}`);
  console.log(`═══════════════════════════════════════════════════════════\n`);

  // Verify all images have analysis
  const { data: finalCheck } = await supabase
    .from('vehicle_images')
    .select('id, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID);

  const stillMissing = finalCheck?.filter(img => !img.ai_scan_metadata?.appraiser?.primary_label) || [];
  
  if (stillMissing.length > 0) {
    console.log(`⚠️  WARNING: ${stillMissing.length} images still missing analysis!`);
    console.log(`   IDs: ${stillMissing.map(img => img.id).join(', ')}`);
  } else {
    console.log(`✅ VERIFIED: ALL images have analysis!`);
  }
}

async function analyzeWithGemini(imageUrl, apiKey) {
  // Download and convert to base64 (chunked to avoid stack overflow)
  const response = await fetch(imageUrl);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  // Convert in chunks to avoid stack overflow
  const maxSize = Math.min(bytes.length, 1000000);
  let base64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < maxSize; i += chunkSize) {
    const chunk = bytes.slice(i, Math.min(i + chunkSize, maxSize));
    base64 += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
  }

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `Analyze this vehicle image. Determine:
1. View angle (exterior_front, exterior_rear, exterior_side, exterior_three_quarter, interior_dashboard, engine_bay, etc.)
2. Condition score (1-10)
3. Rust severity (0-10)
4. Paint quality (1-10)
5. Environment (garage, outdoor, showroom, etc.)
6. Photo quality (professional, amateur, etc.)

Return ONLY valid JSON:
{
  "angle": "exterior_side",
  "condition_score": 6,
  "rust_severity": 4,
  "paint_quality": 5,
  "environment": "garage",
  "photo_quality": "amateur"
}`
            },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    }
  );

  if (!geminiResponse.ok) {
    throw new Error(`Gemini API error: ${geminiResponse.status}`);
  }

  const data = await geminiResponse.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error('No content in Gemini response');
  }

  return JSON.parse(content);
}

async function analyzeWithOpenAI(imageUrl, apiKey) {
  const response = await fetch(imageUrl);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  // Convert in chunks to avoid stack overflow
  const maxSize = Math.min(bytes.length, 1000000);
  let base64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < maxSize; i += chunkSize) {
    const chunk = bytes.slice(i, Math.min(i + chunkSize, maxSize));
    base64 += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
  }

  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
            text: `Analyze this vehicle image. Determine:
1. View angle (exterior_front, exterior_rear, exterior_side, exterior_three_quarter, interior_dashboard, engine_bay, etc.)
2. Condition score (1-10)
3. Rust severity (0-10)
4. Paint quality (1-10)
5. Environment (garage, outdoor, showroom, etc.)
6. Photo quality (professional, amateur, etc.)

Return ONLY valid JSON:
{
  "angle": "exterior_side",
  "condition_score": 6,
  "rust_severity": 4,
  "paint_quality": 5,
  "environment": "garage",
  "photo_quality": "amateur"
}`
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}` }
          }
        ]
      }],
      max_tokens: 300,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    })
  });

  if (!openaiResponse.ok) {
    throw new Error(`OpenAI API error: ${openaiResponse.status}`);
  }

  const data = await openaiResponse.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  return JSON.parse(content);
}

async function analyzeWithClaude(imageUrl, apiKey) {
  const response = await fetch(imageUrl);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  
  // Convert in chunks to avoid stack overflow
  const maxSize = Math.min(bytes.length, 1000000);
  let base64 = '';
  const chunkSize = 8192;
  for (let i = 0; i < maxSize; i += chunkSize) {
    const chunk = bytes.slice(i, Math.min(i + chunkSize, maxSize));
    base64 += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
  }

  const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this vehicle image. Determine:
1. View angle (exterior_front, exterior_rear, exterior_side, exterior_three_quarter, interior_dashboard, engine_bay, etc.)
2. Condition score (1-10)
3. Rust severity (0-10)
4. Paint quality (1-10)
5. Environment (garage, outdoor, showroom, etc.)
6. Photo quality (professional, amateur, etc.)

Return ONLY valid JSON:
{
  "angle": "exterior_side",
  "condition_score": 6,
  "rust_severity": 4,
  "paint_quality": 5,
  "environment": "garage",
  "photo_quality": "amateur"
}`
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64
            }
          }
        ]
      }]
    })
  });

  if (!claudeResponse.ok) {
    throw new Error(`Claude API error: ${claudeResponse.status}`);
  }

  const data = await claudeResponse.json();
  const content = data.content?.[0]?.text;

  if (!content) {
    throw new Error('No content in Claude response');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in Claude response');
  }

  return JSON.parse(jsonMatch[0]);
}

analyzeALLImages().catch(console.error);

