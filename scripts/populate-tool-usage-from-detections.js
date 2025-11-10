/**
 * POPULATE TOOL USAGE FROM AI DETECTIONS
 * Backfill tool usage stats from image_tags where tools were detected
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VIVA_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4'; // Skylar

async function populateToolUsage() {
  console.log('📊 POPULATING TOOL USAGE STATS FROM AI DETECTIONS...\n');

  // Get all tool detections from image_tags
  const { data: toolTags, error } = await supabase
    .from('image_tags')
    .select('id, text, tag_name, vehicle_id, metadata, ai_detection_data')
    .or('tag_type.eq.tool,text.ilike.%snap%,text.ilike.%wrench%,text.ilike.%socket%,text.ilike.%ratchet%');

  if (error) {
    console.error('❌ Error loading tool tags:', error);
    return;
  }

  console.log(`🔍 Found ${toolTags.length} tool detections\n`);

  // Group by tool name/brand
  const toolUsageMap = new Map();

  toolTags.forEach(tag => {
    const toolText = tag.text || tag.tag_name || '';
    
    // Try to extract brand and part
    let brand = null;
    let description = toolText;
    
    if (toolText.toLowerCase().includes('snap')) brand = 'Snap-on';
    else if (toolText.toLowerCase().includes('mac')) brand = 'Mac Tools';
    else if (toolText.toLowerCase().includes('matco')) brand = 'Matco';
    else if (toolText.toLowerCase().includes('craftsman')) brand = 'Craftsman';
    
    const key = `${brand || 'Unknown'}_${toolText}`;
    
    if (!toolUsageMap.has(key)) {
      toolUsageMap.set(key, {
        brand,
        description: toolText,
        uses: [],
        vehicles: new Set()
      });
    }
    
    const tool = toolUsageMap.get(key);
    tool.uses.push({
      date: tag.created_at,
      vehicle_id: tag.vehicle_id
    });
    if (tag.vehicle_id) tool.vehicles.add(tag.vehicle_id);
  });

  console.log(`🔧 Identified ${toolUsageMap.size} unique tools\n`);

  let inserted = 0;

  for (const [key, data] of toolUsageMap) {
    const latestUse = data.uses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    
    const { error: insertError } = await supabase
      .from('tool_usage_stats')
      .insert({
        part_number: null,
        brand: data.brand,
        tool_description: data.description,
        total_uses: data.uses.length,
        last_used_at: latestUse.date,
        vehicles_used_on: Array.from(data.vehicles),
        updated_at: new Date().toISOString()
      });

    if (insertError) {
      console.error(`❌ Error inserting ${data.description}:`, insertError.message);
    } else {
      inserted++;
      if (inserted % 10 === 0) {
        process.stdout.write(`  Inserted ${inserted}/${toolUsageMap.size}...\n`);
      }
    }
  }

  console.log(`\n✅ Populated ${inserted} tool usage records!`);
}

populateToolUsage();

