import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

const VEHICLE_ID = '1fe31397-4f41-490f-87a2-b8dc44cb7c09';

async function analyzeExistingImages() {
  console.log('🔍 Analyzing existing images for AI metadata...\n');

  // Get all images without ai_scan_metadata
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, ai_scan_metadata')
    .eq('vehicle_id', VEHICLE_ID)
    .order('created_at', { ascending: true });

  if (!images || images.length === 0) {
    console.log('No images found');
    return;
  }

  const needsAnalysis = images.filter(img => !img.ai_scan_metadata?.appraiser);
  console.log(`Found ${images.length} total images, ${needsAnalysis.length} need analysis\n`);

  if (needsAnalysis.length === 0) {
    console.log('✅ All images already have analysis!');
    return;
  }

  let analyzed = 0;
  let failed = 0;

  for (const image of needsAnalysis) {
    try {
      console.log(`[${analyzed + failed + 1}/${needsAnalysis.length}] Analyzing: ${image.image_url.substring(0, 60)}...`);

      // Download image
      const response = await fetch(image.image_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NukeBot/1.0)',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.log(`  ❌ Download failed (${response.status})`);
        failed++;
        continue;
      }

      const imageBuffer = await response.arrayBuffer();
      const imageBytes = new Uint8Array(imageBuffer);

      // Convert to base64 (limit size for API)
      const maxSize = Math.min(imageBytes.length, 1000000);
      const base64Image = btoa(String.fromCharCode(...imageBytes.slice(0, maxSize)));

      // AI Analysis
      const analysis = await analyzeImage(base64Image, openaiKey);

      if (analysis) {
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
        if (analysis.angle) {
          descriptionParts.push(`Angle: ${angleLabels[analysis.angle] || analysis.angle}`);
        }
        if (analysis.condition_score) {
          descriptionParts.push(`Condition: ${analysis.condition_score}/10`);
        }

        const contextParts = [];
        if (analysis.environment) {
          contextParts.push(`Environment: ${analysis.environment}`);
        }
        if (analysis.photo_quality) {
          contextParts.push(`Photo quality: ${analysis.photo_quality}`);
        }

        const aiScanMetadata = {
          appraiser: {
            angle: analysis.angle || 'exterior',
            primary_label: angleLabels[analysis.angle || 'exterior'] || 'Exterior View',
            description: descriptionParts.join(' • ') || 'Vehicle exterior view',
            context: contextParts.join(' | ') || 'ClassicCars.com listing photo',
            model: 'gpt-4o',
            analyzed_at: new Date().toISOString(),
            condition_score: analysis.condition_score,
            rust_severity: analysis.rust_severity,
            paint_quality: analysis.paint_quality
          }
        };

        // Update image record
        const { error } = await supabase
          .from('vehicle_images')
          .update({
            ai_scan_metadata: aiScanMetadata,
            ai_processing_status: 'completed'
          })
          .eq('id', image.id);

        if (error) {
          console.log(`  ❌ Update failed: ${error.message}`);
          failed++;
        } else {
          console.log(`  ✅ Analyzed (Condition: ${analysis.condition_score || 'N/A'}/10)`);
          analyzed++;
        }
      } else {
        console.log(`  ⚠️  No analysis returned`);
        failed++;
      }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Complete!`);
  console.log(`  Analyzed: ${analyzed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`\n🔗 Profile: https://n-zero.dev/vehicle/${VEHICLE_ID}\n`);
}

async function analyzeImage(base64Image, apiKey) {
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
              text: `Analyze this vehicle image. Determine:
1. View angle (exterior_front, exterior_rear, exterior_side, exterior_three_quarter, interior_dashboard, engine_bay, etc.)
2. Condition score (1-10)
3. Rust severity (0-10)
4. Paint quality (1-10)
5. Environment (garage, outdoor, showroom, etc.)
6. Photo quality (professional, amateur, etc.)

Return JSON:
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
              image_url: { url: `data:image/jpeg;base64,${base64Image}` }
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

    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

analyzeExistingImages().catch(console.error);

