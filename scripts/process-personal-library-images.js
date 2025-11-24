#!/usr/bin/env node
/**
 * Personal Library Image Processing Script
 * 
 * Processes unorganized photos in personal library:
 * 1. Runs lightweight AI analysis (vehicle detection, angle classification)
 * 2. Clusters similar photos
 * 3. Creates vehicle suggestions
 * 
 * Usage:
 *   node scripts/process-personal-library-images.js [user_id]
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://pmpzuaognyqrgqrkghvb.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Simple vehicle detection using GPT-4o-mini
async function analyzeImageLightweight(imageUrl) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const prompt = `Analyze this image quickly and return ONLY a JSON object (no markdown, no explanation):
{
  "is_vehicle": boolean,
  "vehicle": {
    "year": number or null,
    "make": string or null,
    "model": string or null,
    "confidence": 0.0-1.0
  },
  "angle": "front" | "front_three_quarter" | "rear" | "rear_three_quarter" | "side" | "interior" | "engine_bay" | "undercarriage" | "detail" | "unknown",
  "angle_confidence": 0.0-1.0,
  "vin_visible": boolean,
  "vin": string or null
}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 300
    })
  });

  const data = await response.json();
  const content = data.choices[0].message.content;
  
  // Parse JSON response
  return JSON.parse(content);
}

// Group photos by vehicle
function clusterPhotosByVehicle(photos) {
  const clusters = {};
  
  for (const photo of photos) {
    if (!photo.ai_detected_vehicle) continue;
    
    const { year, make, model } = photo.ai_detected_vehicle;
    if (!make || !model) continue;
    
    const key = `${year || 'unknown'}_${make}_${model}`.toLowerCase();
    
    if (!clusters[key]) {
      clusters[key] = {
        year,
        make,
        model,
        photos: [],
        vin: null,
        confidence: 0
      };
    }
    
    clusters[key].photos.push(photo);
    
    // Track highest confidence VIN
    if (photo.ai_detected_vehicle.vin && !clusters[key].vin) {
      clusters[key].vin = photo.ai_detected_vehicle.vin;
    }
    
    // Average confidence
    clusters[key].confidence = 
      (clusters[key].confidence * (clusters[key].photos.length - 1) + photo.ai_detected_vehicle.confidence) / 
      clusters[key].photos.length;
  }
  
  return Object.values(clusters).filter(c => c.photos.length >= 3); // Min 3 photos for suggestion
}

async function processUserLibrary(userId) {
  console.log(`\n🔄 Processing personal library for user: ${userId}\n`);
  
  // Get unorganized photos with pending AI status
  const { data: photos, error } = await supabase
    .from('vehicle_images')
    .select('*')
    .eq('user_id', userId)
    .is('vehicle_id', null)
    .eq('ai_processing_status', 'pending')
    .limit(100); // Process in batches
  
  if (error) {
    console.error('❌ Error fetching photos:', error);
    return;
  }
  
  if (!photos || photos.length === 0) {
    console.log('✅ No photos to process');
    return;
  }
  
  console.log(`📸 Found ${photos.length} photos to analyze\n`);
  
  // Process each photo
  const processedPhotos = [];
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    console.log(`[${i + 1}/${photos.length}] Analyzing ${photo.file_name}...`);
    
    try {
      // Mark as processing
      await supabase
        .from('vehicle_images')
        .update({ 
          ai_processing_status: 'processing',
          ai_processing_started_at: new Date().toISOString()
        })
        .eq('id', photo.id);
      
      // Run AI analysis
      const analysis = await analyzeImageLightweight(photo.image_url);
      
      // Update photo with results
      const updates = {
        ai_processing_status: 'complete',
        ai_processing_completed_at: new Date().toISOString(),
        ai_suggestions: analysis
      };
      
      if (analysis.is_vehicle && analysis.vehicle) {
        updates.ai_detected_vehicle = analysis.vehicle;
      }
      
      if (analysis.angle) {
        updates.ai_detected_angle = analysis.angle;
        updates.ai_detected_angle_confidence = analysis.angle_confidence;
      }
      
      await supabase
        .from('vehicle_images')
        .update(updates)
        .eq('id', photo.id);
      
      if (analysis.is_vehicle) {
        console.log(`   ✓ Vehicle detected: ${analysis.vehicle.year || '?'} ${analysis.vehicle.make} ${analysis.vehicle.model} (${Math.round(analysis.vehicle.confidence * 100)}%)`);
        processedPhotos.push({ ...photo, ai_detected_vehicle: analysis.vehicle });
      } else {
        console.log(`   ℹ️  Not a vehicle`);
      }
      
      // Rate limit (OpenAI allows ~50 req/min on mini)
      await new Promise(resolve => setTimeout(resolve, 1200));
      
    } catch (error) {
      console.error(`   ❌ Failed:`, error.message);
      
      // Mark as failed
      await supabase
        .from('vehicle_images')
        .update({ 
          ai_processing_status: 'failed',
          ai_suggestions: { error: error.message }
        })
        .eq('id', photo.id);
    }
  }
  
  console.log(`\n📊 Analysis complete: ${processedPhotos.length} vehicles detected\n`);
  
  // Cluster photos and create suggestions
  if (processedPhotos.length > 0) {
    console.log('🧠 Clustering photos by vehicle...\n');
    const clusters = clusterPhotosByVehicle(processedPhotos);
    
    for (const cluster of clusters) {
      console.log(`\n📋 Suggestion: ${cluster.year || '?'} ${cluster.make} ${cluster.model}`);
      console.log(`   Photos: ${cluster.photos.length}`);
      console.log(`   Confidence: ${Math.round(cluster.confidence * 100)}%`);
      if (cluster.vin) console.log(`   VIN: ${cluster.vin}`);
      
      // Create vehicle suggestion
      const sampleImageIds = cluster.photos.slice(0, 5).map(p => p.id);
      
      const { data: suggestion, error: suggestionError } = await supabase
        .from('vehicle_suggestions')
        .insert({
          user_id: userId,
          suggested_year: cluster.year,
          suggested_make: cluster.make,
          suggested_model: cluster.model,
          suggested_vin: cluster.vin,
          confidence: cluster.confidence,
          image_count: cluster.photos.length,
          sample_image_ids: sampleImageIds,
          detection_method: cluster.vin ? 'vin_detection' : 'visual_analysis',
          reasoning: cluster.vin 
            ? `VIN ${cluster.vin} detected in ${cluster.photos.length} photos`
            : `Visual analysis found ${cluster.photos.length} photos matching this vehicle`,
          status: 'pending'
        })
        .select('id')
        .single();
      
      if (suggestionError) {
        console.error(`   ❌ Failed to create suggestion:`, suggestionError);
        continue;
      }
      
      // Link photos to suggestion
      for (const photo of cluster.photos) {
        await supabase
          .from('vehicle_images')
          .update({ suggested_vehicle_id: suggestion.id })
          .eq('id', photo.id);
      }
      
      console.log(`   ✓ Suggestion created (ID: ${suggestion.id})`);
    }
    
    console.log(`\n✅ Created ${clusters.length} vehicle suggestions`);
  }
  
  console.log('\n🎉 Processing complete!\n');
}

// Main
async function main() {
  const userId = process.argv[2];
  
  if (!userId) {
    console.error('❌ Usage: node process-personal-library-images.js [user_id]');
    console.error('\nTo process all users:');
    console.error('  node process-personal-library-images.js --all');
    process.exit(1);
  }
  
  if (userId === '--all') {
    // Get all users with unorganized photos
    const { data: users, error } = await supabase
      .from('vehicle_images')
      .select('user_id')
      .is('vehicle_id', null)
      .eq('ai_processing_status', 'pending');
    
    if (error) {
      console.error('❌ Error fetching users:', error);
      process.exit(1);
    }
    
    const uniqueUsers = [...new Set(users.map(u => u.user_id))];
    console.log(`\n📋 Found ${uniqueUsers.length} users with unorganized photos\n`);
    
    for (const uid of uniqueUsers) {
      await processUserLibrary(uid);
    }
  } else {
    await processUserLibrary(userId);
  }
}

main().catch(console.error);

