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

const BATCH_SIZE = 20; // Smaller batches to avoid timeouts
const DELAY_BETWEEN_BATCHES = 2000;

if (!OPENAI_KEY) {
  console.error('❌ OPENAI_API_KEY not found');
  process.exit(1);
}

console.log('🚀 Starting continuous image processing...\n');

async function processBatch(offset, limit) {
  // Get batch of images
  const { data: images, error } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, ai_scan_metadata')
    .is('ai_scan_metadata->appraiser->primary_label', null)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error || !images || images.length === 0) {
    return { processed: 0, failed: 0, done: true };
  }

  let processed = 0;
  let failed = 0;

  for (const image of images) {
    try {
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
1. View angle (exterior_front, exterior_rear, exterior_side, exterior_three_quarter, interior_dashboard, engine_bay, undercarriage, detail_shot)
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
        failed++;
        continue;
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      if (!content) {
        failed++;
        continue;
      }

      let result;
      try {
        result = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          failed++;
          continue;
        }
      }

      const angleLabels = {
        'exterior_front': 'Front View',
        'exterior_rear': 'Rear View',
        'exterior_side': 'Side View',
        'exterior_three_quarter': 'Three-Quarter View',
        'interior_dashboard': 'Interior - Dashboard',
        'interior_front_seats': 'Interior - Front Seats',
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
      if (result.rust_severity !== undefined) {
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
          context: contextParts.join(' | ') || 'Vehicle listing photo',
          model: 'gpt-4o',
          analyzed_at: new Date().toISOString(),
          condition_score: result.condition_score,
          rust_severity: result.rust_severity,
          paint_quality: result.paint_quality
        }
      };

      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update({
          ai_scan_metadata: aiScanMetadata,
          ai_processing_status: 'completed'
        })
        .eq('id', image.id);

      if (updateError) {
        failed++;
      } else {
        processed++;
      }

      // Rate limit delay
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      failed++;
    }
  }

  return { processed, failed, done: false };
}

async function runContinuous() {
  let totalProcessed = 0;
  let totalFailed = 0;
  let offset = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    console.log(`\n📦 Batch ${batchNum} (offset: ${offset})`);

    const result = await processBatch(offset, BATCH_SIZE);

    totalProcessed += result.processed;
    totalFailed += result.failed;

    console.log(`  ✅ Processed: ${result.processed}`);
    console.log(`  ❌ Failed: ${result.failed}`);
    console.log(`  📊 Total: ${totalProcessed} processed, ${totalFailed} failed`);

    if (result.done || result.processed === 0) {
      console.log('\n✅ All images processed!');
      break;
    }

    offset += BATCH_SIZE;

    // Check remaining
    const { count: remaining } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .is('ai_scan_metadata->appraiser->primary_label', null);

    if (!remaining || remaining === 0) {
      console.log('\n✅ All images analyzed!');
      break;
    }

    console.log(`  ⏳ Remaining: ${remaining}`);
    console.log(`  ⏸️  Waiting ${DELAY_BETWEEN_BATCHES}ms...`);

    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 FINAL RESULTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`✅ Total processed: ${totalProcessed}`);
  console.log(`❌ Total failed: ${totalFailed}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

runContinuous().catch(console.error);

