import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const VEHICLE_ID = '1fe31397-4f41-490f-87a2-b8dc44cb7c09';

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not found in .env.local');
  process.exit(1);
}

console.log('🚨 FINAL ANALYSIS - Processing ALL images\n');
console.log(`OpenAI Key: ${OPENAI_KEY.substring(0, 10)}...${OPENAI_KEY.substring(OPENAI_KEY.length - 4)}\n`);

async function analyzeAll() {
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .order('created_at', { ascending: true });

  if (!images || images.length === 0) {
    console.log('❌ No images found');
    return;
  }

  const needsAnalysis = images.filter(img => !img.ai_scan_metadata?.appraiser?.primary_label);
  console.log(`📊 Total: ${images.length}, Need analysis: ${needsAnalysis.length}\n`);

  if (needsAnalysis.length === 0) {
    console.log('✅ All images already analyzed!');
    return;
  }

  let analyzed = 0;
  let failed = 0;

  for (let i = 0; i < needsAnalysis.length; i++) {
    const image = needsAnalysis[i];
    
    try {
      console.log(`[${i + 1}/${needsAnalysis.length}] Analyzing ${image.id.substring(0, 8)}...`);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
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
                image_url: { url: image.image_url }
              }
            ]
          }],
          max_tokens: 300,
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`  ❌ API error ${response.status}: ${errorText.substring(0, 100)}`);
        failed++;
        continue;
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        console.log(`  ❌ No content in response`);
        failed++;
        continue;
      }

      const result = JSON.parse(content);

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
          model: 'gpt-4o',
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
      } else {
        console.log(`  ✅ Analyzed (Condition: ${result.condition_score || 'N/A'}/10)`);
        analyzed++;
      }

      // Rate limit delay
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Complete: ${analyzed} analyzed, ${failed} failed\n`);
  
  // Final verification
  const { data: final } = await supabase
    .from('vehicle_images')
    .select('id, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID);

  const stillMissing = final?.filter(img => !img.ai_scan_metadata?.appraiser?.primary_label).length || 0;
  
  if (stillMissing > 0) {
    console.log(`⚠️  WARNING: ${stillMissing} images still missing analysis`);
  } else {
    console.log(`✅ VERIFIED: ALL ${final.length} images have analysis!`);
  }
}

analyzeAll().catch(console.error);

