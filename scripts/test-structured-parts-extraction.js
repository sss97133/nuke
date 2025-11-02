#!/usr/bin/env node
/**
 * Test Structured Parts Extraction
 * Re-processes one Bronco work log to test new parts extraction
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testPartsExtraction() {
  console.log('🔍 Finding Bronco work with images at Ernie\'s Upholstery...\n');

  // Find org
  const { data: org } = await supabase
    .from('businesses')
    .select('id, business_name')
    .ilike('business_name', '%ernie%')
    .single();

  if (!org) {
    console.log('❌ Ernie\'s Upholstery not found');
    return;
  }

  console.log(`✅ Found: ${org.business_name} (${org.id})`);

  // Find Bronco (use first one)
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .eq('make', 'Ford')
    .ilike('model', '%bronco%')
    .limit(1);
  
  const vehicle = vehicles?.[0];

  if (!vehicle) {
    console.log('❌ Bronco not found');
    return;
  }

  console.log(`✅ Found: ${vehicle.year} ${vehicle.make} ${vehicle.model} (${vehicle.id})\n`);

  // Find images from Oct 30, 2025 at Ernie's
  const { data: images } = await supabase
    .from('vehicle_images')
    .select('id, image_url, taken_at')
    .eq('vehicle_id', vehicle.id)
    .gte('taken_at', '2025-10-30')
    .lt('taken_at', '2025-10-31')
    .order('taken_at', { ascending: true })
    .limit(10);

  if (!images || images.length === 0) {
    console.log('❌ No images found for Oct 30, 2025');
    return;
  }

  console.log(`✅ Found ${images.length} images from Oct 30, 2025\n`);

  // Call generate-work-logs edge function
  console.log('🤖 Calling AI to generate work log with structured parts data...\n');

  const response = await fetch(`${supabaseUrl}/functions/v1/generate-work-logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`
    },
    body: JSON.stringify({
      vehicleId: vehicle.id,
      organizationId: org.id,
      imageIds: images.map(img => img.id),
      eventDate: '2025-10-30'
    })
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('❌ Edge function error:', error);
    return;
  }

  const result = await response.json();

  if (!result.success) {
    console.error('❌ Work log generation failed:', result.error);
    return;
  }

  console.log('✅ Work log generated successfully!\n');
  console.log('📋 Event ID:', result.eventId);
  console.log('🛒 Parts extracted:', result.partsCount);
  console.log('⏱ Labor tasks:', result.laborTasksCount);
  console.log('\n📝 Work Log Details:');
  console.log('Title:', result.workLog.title);
  console.log('Hours:', result.workLog.estimatedLaborHours);
  console.log('Value:', `$${result.workLog.valueImpact.toLocaleString()}`);
  console.log('Quality:', `${result.workLog.qualityRating}/10`);
  console.log('Confidence:', `${(result.workLog.confidence * 100).toFixed(0)}%`);

  if (result.workLog.partsExtracted && result.workLog.partsExtracted.length > 0) {
    console.log('\n🛒 Parts Extracted:');
    result.workLog.partsExtracted.forEach((part, idx) => {
      console.log(`\n${idx + 1}. ${part.name}`);
      if (part.brand) console.log(`   Brand: ${part.brand}`);
      if (part.partNumber) console.log(`   Part #: ${part.partNumber}`);
      console.log(`   Quantity: ${part.quantity}${part.unit ? ' ' + part.unit : ''}`);
      console.log(`   Price: $${part.estimatedPrice.toLocaleString()}`);
      if (part.supplier) console.log(`   Supplier: ${part.supplier}`);
      if (part.notes) console.log(`   Notes: ${part.notes}`);
    });
  }

  if (result.workLog.laborBreakdown && result.workLog.laborBreakdown.length > 0) {
    console.log('\n⏱ Labor Breakdown:');
    result.workLog.laborBreakdown.forEach((task, idx) => {
      console.log(`\n${idx + 1}. ${task.task}`);
      console.log(`   Category: ${task.category}`);
      console.log(`   Hours: ${task.hours}h`);
      console.log(`   Difficulty: ${task.difficulty}/10`);
    });
  }

  console.log('\n✅ Test complete! Check the work order viewer to see the new parts and labor data.');
}

testPartsExtraction().catch(console.error);

