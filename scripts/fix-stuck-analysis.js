#!/usr/bin/env node

/**
 * FIX STUCK ANALYSIS
 * 
 * Use EXISTING analyze-image function to process the 183k stuck images
 * Don't create new systems - fix what works
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('🔧 FIXING STUCK ANALYSIS');
  console.log('========================');
  console.log('Using EXISTING analyze-image function (not creating new ones)');
  console.log('');
  
  // Check current status
  const { data: status } = await supabase
    .from('vehicle_images')
    .select('ai_processing_status')
    .is('ai_processing_status', 'pending')
    .limit(1, { count: 'exact' });
  
  console.log(`📊 Pending images: ${status?.length || 0}`);
  
  try {
    // Use existing batch processor
    console.log('🔄 Triggering existing batch processor...');
    
    const response = await fetch(`${SUPABASE_URL}/functions/v1/process-all-images-cron`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        max_images: 100, // Start small to test
        batch_size: 10
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Batch processor failed: ${response.status} ${error}`);
    }
    
    const result = await response.json();
    console.log('✅ Batch processing result:', result);
    
    if (result.success) {
      console.log('');
      console.log('🎯 EXISTING SYSTEM IS WORKING!');
      console.log('==============================');
      console.log('The analyze-image function works fine.');
      console.log('Just need to process the backlog with existing tools.');
      console.log('');
      console.log('📋 Next steps:');
      console.log('1. Process all 183k images with existing batch processor');
      console.log('2. Monitor progress with existing functions');
      console.log('3. No need for new analysis functions');
      console.log('');
      console.log('🚀 To process all stuck images:');
      console.log(`   curl -X POST '${SUPABASE_URL}/functions/v1/process-all-images-cron' \\`);
      console.log(`        -H 'Authorization: Bearer service_key' \\`);
      console.log(`        -d '{"max_images": 183000, "batch_size": 100}'`);
    } else {
      console.log('❌ Existing batch processor has issues');
      console.log('Need to debug the existing analyze-image function');
    }
    
  } catch (error) {
    console.log('❌ Existing system has issues:', error.message);
    console.log('');
    console.log('🔍 DEBUG STEPS:');
    console.log('1. Check function logs: supabase functions logs analyze-image');
    console.log('2. Check function deployment: supabase functions list');
    console.log('3. Check for missing env vars or API key issues');
    console.log('4. Consider redeploying existing function if needed');
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
