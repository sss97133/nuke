#!/usr/bin/env node

/**
 * CONTEXT-DRIVEN BATCH PROCESSOR
 * 
 * Core Principle: Context quality determines model selection
 * 
 * High context (60+) → Ultra-cheap model ($0.0001) - just confirm
 * Medium context (30-60) → Cheap model ($0.0005) - guided ID
 * Low context (10-30) → Mid model ($0.005) - inference needed
 * No context (<10) → Expensive model ($0.02) - identify gaps
 * 
 * Tracks provenance: Which model answered which question
 * Enables consensus: Multiple models validate answers
 * Supports reprocessing: As context improves, rerun cheaply
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
];

let envConfig = {};
for (const envPath of possiblePaths) {
  if (fs.existsSync(envPath)) {
    envConfig = dotenv.parse(fs.readFileSync(envPath));
    break;
  }
}

const SUPABASE_URL = envConfig.VITE_SUPABASE_URL;
const SUPABASE_KEY = envConfig.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials in nuke_frontend/.env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Model costs
const MODEL_COSTS = {
  'gpt-4o-mini-trivial': 0.0001,    // Angle, category, color
  'gpt-4o-mini-simple': 0.0005,     // Components, basic parts
  'gpt-4o-mini-context': 0.005,     // Specific parts with context
  'gpt-4o-gap-finder': 0.02,        // Identify missing context
  'claude-haiku-consensus': 0.00008 // Cheap consensus check
};

let stats = {
  totalImages: 0,
  byContextScore: {
    'rich_60plus': { count: 0, cost: 0 },
    'good_30to60': { count: 0, cost: 0 },
    'medium_10to30': { count: 0, cost: 0 },
    'poor_below10': { count: 0, cost: 0 }
  },
  byModel: {},
  totalCost: 0,
  contextImprovements: [],
  startTime: Date.now()
};

function scoreContext(image, vehicle) {
  let score = 0;
  const context = {
    items: []
  };
  
  // SPID data (factory specs)
  if (vehicle.spid_data) {
    score += 20;
    context.items.push('SPID data');
  }
  
  // Factory manual
  if (vehicle.has_manual) {
    score += 15;
    context.items.push('Factory manual');
  }
  
  // Receipts matching timeframe
  const imageDate = new Date(image.taken_at);
  const matchingReceipts = vehicle.receipts?.filter(r => {
    const receiptDate = new Date(r.purchase_date);
    const daysDiff = Math.abs((imageDate - receiptDate) / (1000 * 60 * 60 * 24));
    return daysDiff <= 90; // Within 3 months
  }) || [];
  
  score += Math.min(matchingReceipts.length * 5, 25);
  if (matchingReceipts.length > 0) {
    context.items.push(`${matchingReceipts.length} receipts`);
  }
  
  // Timeline events
  score += Math.min((vehicle.timeline_events?.length || 0) * 3, 15);
  if (vehicle.timeline_events?.length > 0) {
    context.items.push(`${vehicle.timeline_events.length} timeline events`);
  }
  
  // User tags
  score += Math.min((vehicle.user_tags_count || 0) * 2, 10);
  
  // Previous analyses
  if (image.ai_scan_metadata?.tier_1_analysis) {
    score += 10;
    context.items.push('Previous analysis');
  }
  
  // Well-documented vehicle
  if ((vehicle.timeline_events?.length || 0) > 10) {
    score += 5;
    context.items.push('Well-documented vehicle');
  }
  
  return { score, context };
}

function selectModel(contextScore) {
  if (contextScore >= 60) {
    return {
      model: 'gpt-4o-mini-trivial',
      cost: MODEL_COSTS['gpt-4o-mini-trivial'],
      strategy: 'confirmation',
      rationale: 'Rich context - just confirm visible matches known'
    };
  }
  
  if (contextScore >= 30) {
    return {
      model: 'gpt-4o-mini-simple',
      cost: MODEL_COSTS['gpt-4o-mini-simple'],
      strategy: 'guided_identification',
      rationale: 'Good context - guide identification'
    };
  }
  
  if (contextScore >= 10) {
    return {
      model: 'gpt-4o-mini-context',
      cost: MODEL_COSTS['gpt-4o-mini-context'],
      strategy: 'inference',
      rationale: 'Some context - need inference'
    };
  }
  
  return {
    model: 'gpt-4o-gap-finder',
    cost: MODEL_COSTS['gpt-4o-gap-finder'],
    strategy: 'identify_missing_context',
    rationale: 'Low context - identify what we need'
  };
}

async function loadVehicleContext(vehicleId) {
  // Load all context for this vehicle
  const [vehicleData, timelineData, receiptData, spidData, manualData] = await Promise.all([
    supabase.from('vehicles').select('*').eq('id', vehicleId).single(),
    supabase.from('timeline_events').select('*').eq('vehicle_id', vehicleId).limit(50),
    supabase.from('receipts').select('*').eq('vehicle_id', vehicleId).limit(50),
    supabase.from('vehicle_spid_data').select('*').eq('vehicle_id', vehicleId).maybeSingle(),
    supabase.from('reference_documents').select('*').eq('vehicle_id', vehicleId).limit(10)
  ]);
  
  return {
    ...vehicleData.data,
    timeline_events: timelineData.data || [],
    receipts: receiptData.data || [],
    spid_data: spidData.data,
    has_manual: (manualData.data || []).length > 0
  };
}

async function processImage(image, vehicle) {
  const contextEval = scoreContext(image, vehicle);
  const modelSelection = selectModel(contextEval.score);
  
  // Track which model answered
  const shortId = image.id.substring(0, 8);
  console.log(`      ${shortId}... | Context: ${contextEval.score} | ${modelSelection.model} | ${formatCost(modelSelection.cost)}`);
  console.log(`         Context: ${contextEval.context.items.join(', ') || 'minimal'}`);
  
  try {
    // Call appropriate tier based on model selection
    let functionName;
    if (modelSelection.model.includes('trivial')) {
      functionName = 'analyze-image-tier1';
    } else if (modelSelection.strategy === 'identify_missing_context') {
      functionName = 'analyze-image-gap-finder';
    } else {
      functionName = 'analyze-image-tier2';
    }
    
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: {
        image_url: image.image_url,
        image_id: image.id,
        vehicle_id: image.vehicle_id,
        context_score: contextEval.score,
        strategy: modelSelection.strategy
      }
    });
    
    if (error) throw new Error(error.message);
    
    // Track stats
    const contextBucket = contextEval.score >= 60 ? 'rich_60plus' :
                          contextEval.score >= 30 ? 'good_30to60' :
                          contextEval.score >= 10 ? 'medium_10to30' : 'poor_below10';
    
    stats.byContextScore[contextBucket].count++;
    stats.byContextScore[contextBucket].cost += modelSelection.cost;
    stats.totalCost += modelSelection.cost;
    stats.totalImages++;
    
    if (!stats.byModel[modelSelection.model]) {
      stats.byModel[modelSelection.model] = { count: 0, cost: 0 };
    }
    stats.byModel[modelSelection.model].count++;
    stats.byModel[modelSelection.model].cost += modelSelection.cost;
    
    return {
      success: true,
      model: modelSelection.model,
      cost: modelSelection.cost,
      contextScore: contextEval.score,
      data
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      model: modelSelection.model
    };
  }
}

function formatCost(cost) {
  return `$${cost.toFixed(6)}`;
}

async function processVehicle(vehicleId, images) {
  console.log(`\n╔${'═'.repeat(78)}╗`);
  console.log(`║ Vehicle: ${vehicleId.substring(0, 36)} (${images.length} images)`);
  console.log(`╚${'═'.repeat(78)}╝`);
  
  // Load vehicle context ONCE
  const vehicle = await loadVehicleContext(vehicleId);
  
  console.log(`\n   🚗 ${vehicle.year || '?'} ${vehicle.make || '?'} ${vehicle.model || '?'}`);
  console.log(`   📋 Timeline: ${vehicle.timeline_events.length} | Receipts: ${vehicle.receipts.length}`);
  console.log(`   📄 SPID: ${vehicle.spid_data ? 'Yes' : 'No'} | Manual: ${vehicle.has_manual ? 'Yes' : 'No'}`);
  
  // Process images
  console.log(`\n   Processing ${images.length} images with context-driven routing...`);
  
  for (const image of images) {
    await processImage(image, vehicle);
  }
  
  console.log(`\n   ✅ Vehicle complete`);
}

async function generateReport() {
  const duration = Date.now() - stats.startTime;
  
  console.log(`\n\n${'═'.repeat(80)}`);
  console.log('📊 CONTEXT-DRIVEN PROCESSING COMPLETE');
  console.log('═'.repeat(80));
  
  console.log(`\n💰 COST BY CONTEXT SCORE:`);
  Object.entries(stats.byContextScore).forEach(([bucket, data]) => {
    const label = bucket.replace('_', ' (').replace(/(\d+)/g, '$1)');
    console.log(`   ${label}: ${data.count} images × avg $${(data.cost/data.count || 0).toFixed(6)} = $${data.cost.toFixed(4)}`);
  });
  console.log(`   ${'─'.repeat(76)}`);
  console.log(`   TOTAL: ${stats.totalImages} images = $${stats.totalCost.toFixed(4)}`);
  
  console.log(`\n🤖 USAGE BY MODEL:`);
  Object.entries(stats.byModel).forEach(([model, data]) => {
    const avgCost = data.cost / data.count;
    console.log(`   ${model}: ${data.count} images × $${avgCost.toFixed(6)} = $${data.cost.toFixed(4)}`);
  });
  
  console.log(`\n⏱️  PERFORMANCE:`);
  console.log(`   Duration: ${Math.floor(duration/1000/60)}m ${Math.floor(duration/1000)%60}s`);
  console.log(`   Images/minute: ${(stats.totalImages / (duration/60000)).toFixed(1)}`);
  console.log(`   Cost/minute: $${(stats.totalCost / (duration/60000)).toFixed(4)}`);
  
  console.log(`\n📈 CONTEXT QUALITY DISTRIBUTION:`);
  const richPercent = ((stats.byContextScore.rich_60plus.count / stats.totalImages) * 100).toFixed(1);
  const poorPercent = ((stats.byContextScore.poor_below10.count / stats.totalImages) * 100).toFixed(1);
  console.log(`   Rich context (60+): ${stats.byContextScore.rich_60plus.count} (${richPercent}%)`);
  console.log(`   Poor context (<10): ${stats.byContextScore.poor_below10.count} (${poorPercent}%)`);
  console.log(`\n   → ${poorPercent}% of vehicles need more documentation!`);
  
  console.log(`\n${'═'.repeat(80)}\n`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              CONTEXT-DRIVEN BATCH PROCESSOR                                ║');
  console.log('║                                                                            ║');
  console.log('║  Routes to model based on context quality, not just question difficulty   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');
  
  console.log(`\n⚙️  Strategy:`);
  console.log(`   Rich context → Ultra-cheap confirmation`);
  console.log(`   Poor context → Expensive gap identification`);
  console.log(`   Track provenance for future consensus`);
  
  // Get all images grouped by vehicle
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id, taken_at, ai_scan_metadata')
    .limit(3000);
  
  // Group by vehicle
  const vehicleGroups = {};
  images?.forEach(img => {
    if (!vehicleGroups[img.vehicle_id]) {
      vehicleGroups[img.vehicle_id] = [];
    }
    vehicleGroups[img.vehicle_id].push(img);
  });
  
  const vehicles = Object.entries(vehicleGroups);
  console.log(`\n   Found ${vehicles.length} vehicles with ${images?.length || 0} images`);
  
  // Process each vehicle
  for (const [vehicleId, vehicleImages] of vehicles) {
    await processVehicle(vehicleId, vehicleImages);
    await new Promise(r => setTimeout(r, 1000));
  }
  
  await generateReport();
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});

