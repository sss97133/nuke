#!/usr/bin/env node
/**
 * Index existing brochure images as reference pages
 * Use AI to detect topics on each page
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const OPENAI_KEY = process.env.OPENAI_API_KEY;

async function indexPages() {
  console.log('📖 Indexing Existing Reference Pages\n');
  
  // Get brochure images that look like reference material
  const { data: docs, error } = await supabase
    .from('library_documents')
    .select('*')
    .eq('document_type', 'brochure')
    .not('file_url', 'is', null)
    .limit(20); // Start with first 20
  
  if (error || !docs || docs.length === 0) {
    console.error('No documents found:', error?.message);
    return;
  }
  
  console.log(`Found ${docs.length} brochure pages to index\n`);
  
  let indexed = 0;
  
  for (const doc of docs) {
    console.log(`\nPage: ${doc.title || doc.id.substring(0, 8)}`);
    console.log(`URL: ${doc.file_url.substring(0, 80)}...`);
    
    // Use AI to detect topics
    const topics = await detectTopics(doc.file_url);
    
    if (topics.length > 0) {
      console.log(`  Topics: ${topics.join(', ')}`);
      
      // Insert as catalog page (create generic catalog if needed)
      // For now, just update the document metadata
      const { error: updateError } = await supabase
        .from('library_documents')
        .update({
          metadata: {
            ...(doc.metadata || {}),
            indexed_topics: topics,
            indexed_at: new Date().toISOString()
          }
        })
        .eq('id', doc.id);
      
      if (updateError) {
        console.error(`  ❌ Failed to update:`, updateError.message);
      } else {
        console.log(`  ✅ Indexed`);
        indexed++;
      }
    } else {
      console.log(`  ⚠️ No topics detected`);
    }
    
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n✅ Indexed ${indexed}/${docs.length} pages`);
}

async function detectTopics(imageUrl) {
  if (!OPENAI_KEY) {
    console.warn('  No OPENAI_API_KEY - skipping AI indexing');
    return [];
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this automotive reference page. What topics does it cover? Return ONLY a JSON array of relevant topics from this list:
["vin_decode", "model_identification", "engine_specs", "transmission", "axle_ratios", "paint_codes", "rpo_codes", "dimensions", "weights", "electrical", "wiring", "maintenance", "torque_specs", "specifications", "options", "color_options"]

Example: ["vin_decode", "model_identification"]

Return ONLY topics that are CLEARLY visible on this page. If no topics match, return empty array [].`
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl }
            }
          ]
        }],
        max_tokens: 100
      })
    });
    
    if (!response.ok) {
      console.error(`  AI request failed: ${response.statusText}`);
      return [];
    }
    
    const result = await response.json();
    const content = result.choices[0].message.content;
    
    // Extract array from response
    const arrayMatch = content.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      const topics = JSON.parse(arrayMatch[0]);
      return Array.isArray(topics) ? topics : [];
    }
    
    return [];
  } catch (e) {
    console.error(`  AI error: ${e.message}`);
    return [];
  }
}

indexPages().catch(console.error);



