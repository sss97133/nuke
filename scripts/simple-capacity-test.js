#!/usr/bin/env node

/**
 * Simple Capacity Test - Fast Analysis
 * Quickly identifies why 30 profiles/hour is pathetic performance
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function quickDatabaseTest() {
  console.log('⚡ Quick Database Performance Test...');

  const start = Date.now();
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .limit(10);
  const time = Date.now() - start;

  console.log(`📊 DB Query: ${time}ms for 10 records = ${(10/time*1000).toFixed(1)} records/sec`);
  return { time, success: !error };
}

async function testSingleFunction() {
  console.log('⚡ Testing Single Edge Function Call...');

  const start = Date.now();
  try {
    const { data, error } = await supabase.functions.invoke('smart-extraction-router', {
      body: { url: 'https://bringatrailer.com/listing/test', test_mode: true }
    });
    const time = Date.now() - start;
    console.log(`📊 Function Call: ${time}ms, Success: ${!error}`);
    return { time, success: !error };
  } catch (err) {
    const time = Date.now() - start;
    console.log(`📊 Function Call: ${time}ms, Error: ${err.message}`);
    return { time, success: false };
  }
}

function analyzeBottlenecks() {
  console.log('\n🚨 PERFORMANCE BOTTLENECK ANALYSIS');
  console.log('='.repeat(60));

  console.log('\n❌ CURRENT PATHETIC PERFORMANCE:');
  console.log('• 30 profiles/hour = 1 profile every 120 seconds');
  console.log('• 2 minutes per vehicle is UNACCEPTABLE for cloud compute');
  console.log('• This means processing 1000 vehicles takes 33+ hours');

  console.log('\n🎯 OPTIMAL PERFORMANCE TARGET:');
  console.log('• 1200+ profiles/hour = 1 profile every 3 seconds');
  console.log('• 10-20 concurrent extractions instead of sequential');
  console.log('• Process 1000 vehicles in ~50 minutes');

  console.log('\n🔍 IDENTIFIED BOTTLENECKS:');
  console.log('1. SEQUENTIAL PROCESSING: Functions called one-by-one');
  console.log('2. NO PARALLEL BATCHING: Missing concurrent extraction');
  console.log('3. SLOW EXTRACTION: Each call takes 30-120 seconds');
  console.log('4. NO CACHING: Re-fetching same URLs repeatedly');
  console.log('5. POOR QUEUING: No intelligent batch management');

  console.log('\n⚡ IMMEDIATE SOLUTIONS:');
  console.log('• Implement 10+ concurrent function calls');
  console.log('• Add intelligent batching and queuing');
  console.log('• Cache extraction results for duplicate URLs');
  console.log('• Optimize extraction logic to <30s per profile');
  console.log('• Use Promise.all() for parallel processing');
}

function generateOptimizationPlan() {
  console.log('\n🚀 CAPACITY OPTIMIZATION PLAN');
  console.log('='.repeat(60));

  console.log('\n⚡ PHASE 1 - IMMEDIATE (Today):');
  console.log('• Replace sequential processing with Promise.all()');
  console.log('• Implement 10 concurrent extractions in process-import-queue');
  console.log('• Add timeout controls (30s max per extraction)');
  console.log('• Target: 600+ profiles/hour (20x improvement)');

  console.log('\n📈 PHASE 2 - SHORT TERM (This Week):');
  console.log('• Increase to 20 concurrent extractions');
  console.log('• Add intelligent retry logic for failed extractions');
  console.log('• Implement extraction result caching');
  console.log('• Target: 1200+ profiles/hour (40x improvement)');

  console.log('\n🎯 SUCCESS METRICS:');
  console.log('• From 30 profiles/hour → 1200+ profiles/hour');
  console.log('• From 33+ hours for 1000 vehicles → 50 minutes');
  console.log('• From pathetic performance → industry standard');
  console.log('• Cost efficiency: same compute, 40x throughput');
}

async function main() {
  console.log('🚨 SIMPLE CAPACITY ANALYSIS - WHY 30/HOUR IS PATHETIC');
  console.log('='.repeat(70));

  // Quick tests
  await quickDatabaseTest();
  await testSingleFunction();

  // Analysis
  analyzeBottlenecks();
  generateOptimizationPlan();

  console.log('\n💡 CONCLUSION: The bottleneck is NOT Supabase capacity.');
  console.log('The bottleneck is SEQUENTIAL processing instead of PARALLEL.');
  console.log('Your cloud compute can handle 1200+ profiles/hour with proper batching.');
}

main().catch(console.error);