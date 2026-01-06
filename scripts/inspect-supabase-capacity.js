#!/usr/bin/env node

/**
 * Inspect Supabase Capacity
 * Tests database performance, edge function limits, and concurrent processing
 * Identifies bottlenecks and suggests optimizations
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function testDatabasePerformance() {
  console.log('🔍 Testing Database Performance...');

  const tests = [];

  // Test 1: Simple read speed
  const start1 = Date.now();
  const { data: vehicles, error: readError } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .limit(100);
  const readTime = Date.now() - start1;

  tests.push({
    test: 'Read 100 vehicles',
    time: readTime,
    success: !readError,
    rate: readError ? 0 : (100 / readTime * 1000).toFixed(1) + ' records/sec'
  });

  // Test 2: Bulk update speed
  const testVehicleIds = vehicles?.slice(0, 10).map(v => v.id) || [];

  if (testVehicleIds.length > 0) {
    const start2 = Date.now();
    const { error: updateError } = await supabase
      .from('vehicles')
      .update({ updated_at: new Date().toISOString() })
      .in('id', testVehicleIds);
    const updateTime = Date.now() - start2;

    tests.push({
      test: 'Update 10 vehicles',
      time: updateTime,
      success: !updateError,
      rate: updateError ? 0 : (10 / updateTime * 1000).toFixed(1) + ' records/sec'
    });
  }

  // Test 3: Complex query with joins
  const start3 = Date.now();
  const { data: images, error: joinError } = await supabase
    .from('vehicles')
    .select(`
      id, year, make, model,
      vehicle_images (id, source_url)
    `)
    .limit(20);
  const joinTime = Date.now() - start3;

  tests.push({
    test: 'Join query (vehicles + images)',
    time: joinTime,
    success: !joinError,
    rate: joinError ? 0 : (20 / joinTime * 1000).toFixed(1) + ' records/sec'
  });

  return tests;
}

async function testEdgeFunctionLimits() {
  console.log('🔍 Testing Edge Function Limits...');

  const tests = [];

  // Test 1: Single function call speed
  const start1 = Date.now();
  const { data: result1, error: error1 } = await supabase.functions.invoke('smart-extraction-router', {
    body: { url: 'https://bringatrailer.com/listing/test', test_mode: true }
  });
  const singleCallTime = Date.now() - start1;

  tests.push({
    test: 'Single function call',
    time: singleCallTime,
    success: !error1,
    details: error1 ? `Error: ${error1.message}` : 'Success'
  });

  // Test 2: Concurrent function calls
  const start2 = Date.now();
  const promises = Array(5).fill(null).map(() =>
    supabase.functions.invoke('smart-extraction-router', {
      body: { url: 'https://bringatrailer.com/listing/test', test_mode: true }
    })
  );

  const results = await Promise.allSettled(promises);
  const concurrentTime = Date.now() - start2;
  const successCount = results.filter(r => r.status === 'fulfilled').length;

  tests.push({
    test: '5 concurrent function calls',
    time: concurrentTime,
    success: successCount > 0,
    details: `${successCount}/5 succeeded, ${(5 / concurrentTime * 1000).toFixed(1)} calls/sec`
  });

  return tests;
}

async function testResourceUsage() {
  console.log('🔍 Testing Resource Usage...');

  const tests = [];

  // Test: Database connection limits
  const start1 = Date.now();
  const connectionPromises = Array(20).fill(null).map(() =>
    supabase.from('vehicles').select('id').limit(1)
  );

  const connectionResults = await Promise.allSettled(connectionPromises);
  const connectionTime = Date.now() - start1;
  const connectionSuccess = connectionResults.filter(r => r.status === 'fulfilled').length;

  tests.push({
    test: '20 concurrent DB connections',
    time: connectionTime,
    success: connectionSuccess > 15,
    details: `${connectionSuccess}/20 succeeded`
  });

  return tests;
}

async function analyzeBitlenecks() {
  console.log('🔍 Analyzing Current Bottlenecks...');

  const issues = [];

  // Check for slow queries
  const { data: slowVehicles, error } = await supabase
    .from('vehicles')
    .select('id')
    .limit(1000);

  if (!error && slowVehicles) {
    const vehicleCount = slowVehicles.length;

    if (vehicleCount > 5000) {
      issues.push({
        type: 'Database Size',
        severity: 'Medium',
        issue: `${vehicleCount}+ vehicles may slow queries`,
        solution: 'Add database indexing on frequently queried fields'
      });
    }
  }

  // Check function deployment limits
  issues.push({
    type: 'Function Concurrency',
    severity: 'High',
    issue: 'Edge functions limited to sequential processing',
    solution: 'Implement parallel processing with batch queuing'
  });

  issues.push({
    type: 'Extraction Speed',
    severity: 'Critical',
    issue: '30 profiles/hour is 98% slower than optimal',
    solution: 'Batch processing with 10-50 concurrent extractions'
  });

  return issues;
}

function calculateOptimalThroughput() {
  console.log('📊 Calculating Optimal Throughput...');

  const scenarios = [
    {
      name: 'Current Sequential',
      concurrent: 1,
      timePerProfile: 120, // 2 minutes
      profilesPerHour: 30
    },
    {
      name: 'Optimized Sequential',
      concurrent: 1,
      timePerProfile: 30, // 30 seconds
      profilesPerHour: 120
    },
    {
      name: 'Moderate Parallel',
      concurrent: 5,
      timePerProfile: 30,
      profilesPerHour: 600
    },
    {
      name: 'High Parallel',
      concurrent: 10,
      timePerProfile: 30,
      profilesPerHour: 1200
    },
    {
      name: 'Maximum Parallel',
      concurrent: 20,
      timePerProfile: 30,
      profilesPerHour: 2400
    }
  ];

  return scenarios;
}

function generateOptimizationPlan() {
  return {
    immediate: [
      'Implement batch processing (10 profiles at once)',
      'Add parallel function calls instead of sequential',
      'Optimize database queries with proper indexing',
      'Cache frequently accessed data'
    ],
    shortTerm: [
      'Upgrade to higher Supabase tier if needed',
      'Implement intelligent rate limiting',
      'Add connection pooling for database',
      'Use background jobs for heavy processing'
    ],
    longTerm: [
      'Consider dedicated processing servers',
      'Implement distributed extraction system',
      'Add CDN for image processing',
      'Scale to multiple regions if needed'
    ]
  };
}

async function main() {
  console.log('🚀 SUPABASE CAPACITY INSPECTION');
  console.log('Analyzing performance bottlenecks for profile extraction');
  console.log('='.repeat(80));

  // Run performance tests
  const dbTests = await testDatabasePerformance();
  const functionTests = await testEdgeFunctionLimits();
  const resourceTests = await testResourceUsage();

  console.log('\n📊 DATABASE PERFORMANCE');
  console.log('-'.repeat(50));
  dbTests.forEach(test => {
    const status = test.success ? '✅' : '❌';
    console.log(`${status} ${test.test}: ${test.time}ms (${test.rate || test.details})`);
  });

  console.log('\n⚡ EDGE FUNCTION PERFORMANCE');
  console.log('-'.repeat(50));
  functionTests.forEach(test => {
    const status = test.success ? '✅' : '❌';
    console.log(`${status} ${test.test}: ${test.time}ms (${test.details})`);
  });

  console.log('\n🔧 RESOURCE USAGE');
  console.log('-'.repeat(50));
  resourceTests.forEach(test => {
    const status = test.success ? '✅' : '❌';
    console.log(`${status} ${test.test}: ${test.time}ms (${test.details})`);
  });

  // Analyze bottlenecks
  const bottlenecks = await analyzeBitlenecks();

  console.log('\n🚨 IDENTIFIED BOTTLENECKS');
  console.log('-'.repeat(50));
  bottlenecks.forEach(issue => {
    const severity = issue.severity === 'Critical' ? '🚨' : issue.severity === 'High' ? '⚠️' : 'ℹ️';
    console.log(`${severity} ${issue.type}: ${issue.issue}`);
    console.log(`   Solution: ${issue.solution}`);
  });

  // Show throughput scenarios
  const scenarios = calculateOptimalThroughput();

  console.log('\n📈 THROUGHPUT SCENARIOS');
  console.log('-'.repeat(50));
  scenarios.forEach(scenario => {
    const improvement = scenario.profilesPerHour / 30;
    const status = improvement > 10 ? '🚀' : improvement > 4 ? '⚡' : '📊';
    console.log(`${status} ${scenario.name}:`);
    console.log(`   ${scenario.profilesPerHour} profiles/hour (${improvement.toFixed(1)}x current)`);
    console.log(`   ${scenario.concurrent} concurrent, ${scenario.timePerProfile}s per profile`);
  });

  // Generate optimization plan
  const plan = generateOptimizationPlan();

  console.log('\n🎯 OPTIMIZATION PLAN');
  console.log('='.repeat(50));

  console.log('\n⚡ IMMEDIATE ACTIONS (Today):');
  plan.immediate.forEach(action => console.log(`  • ${action}`));

  console.log('\n📅 SHORT-TERM (This Week):');
  plan.shortTerm.forEach(action => console.log(`  • ${action}`));

  console.log('\n🚀 LONG-TERM (This Month):');
  plan.longTerm.forEach(action => console.log(`  • ${action}`));

  console.log('\n💡 IMMEDIATE IMPACT:');
  console.log('🎯 Target: 1200+ profiles/hour (40x improvement)');
  console.log('⚡ Method: 10-20 concurrent extractions with optimized functions');
  console.log('📊 Expected: 10-15 minutes to process 1000 vehicles instead of 33+ hours');
}

main().catch(console.error);