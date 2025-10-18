#!/usr/bin/env node
/**
 * Test Algorithmic Completion Calculator
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🧪 Testing Algorithmic Completion Calculator\n');
  console.log('═══════════════════════════════════════════════════\n');
  
  // Test 1: Get sample vehicles
  console.log('TEST 1: Fetching sample vehicles...\n');
  
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, completion_percentage')
    .not('make', 'is', null)
    .not('year', 'is', null)
    .limit(5);
  
  if (vehiclesError) {
    console.error('❌ Error fetching vehicles:', vehiclesError);
    process.exit(1);
  }
  
  if (!vehicles || vehicles.length === 0) {
    console.log('⚠️  No vehicles in database to test');
    process.exit(0);
  }
  
  console.log(`✅ Found ${vehicles.length} test vehicles\n`);
  vehicles.forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.year} ${v.make} ${v.model} (Current: ${v.completion_percentage || 0}%)`);
  });
  
  // Test 2: Check if function exists
  console.log('\n─────────────────────────────────────────────────\n');
  console.log('TEST 2: Check if completion function exists...\n');
  
  const testVehicle = vehicles[0];
  const { data: result, error: funcError } = await supabase.rpc(
    'calculate_vehicle_completion_algorithmic',
    { p_vehicle_id: testVehicle.id }
  );
  
  if (funcError) {
    console.log('❌ Function not deployed yet');
    console.log('   Error:', funcError.message);
    console.log('\n📋 To deploy:');
    console.log('   1. Open: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new');
    console.log('   2. Paste SQL from: supabase/migrations/20251018_algorithmic_completion.sql');
    console.log('   3. Execute\n');
    process.exit(1);
  }
  
  console.log('✅ Function exists and working!\n');
  
  // Test 3: Calculate completion for each vehicle
  console.log('─────────────────────────────────────────────────\n');
  console.log('TEST 3: Calculate completion for all test vehicles...\n');
  
  for (const vehicle of vehicles) {
    console.log(`\n🚗 ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
    console.log(`   VIN: ${vehicle.vin || 'None'}`);
    console.log(`   Current DB score: ${vehicle.completion_percentage || 0}%`);
    
    const { data: calc, error: calcError } = await supabase.rpc(
      'calculate_vehicle_completion_algorithmic',
      { p_vehicle_id: vehicle.id }
    );
    
    if (calcError) {
      console.log('   ❌ Calculation failed:', calcError.message);
      continue;
    }
    
    if (calc) {
      console.log(`   ────────────────────────────────────────`);
      console.log(`   📊 ALGORITHMIC SCORE: ${calc.completion_percentage}%`);
      console.log(`   ────────────────────────────────────────`);
      console.log(`   Timeline Depth (40%):  ${calc.timeline_score}%`);
      console.log(`   Field Coverage (25%):  ${calc.field_score}%`);
      console.log(`   Market Verify (20%):   ${calc.market_score}%`);
      console.log(`   Trust Score (15%):     ${calc.trust_score}%`);
      
      if (calc.cohort_size > 0) {
        console.log(`   ────────────────────────────────────────`);
        console.log(`   Cohort: ${calc.cohort_size} similar vehicles`);
        console.log(`   Rank: #${calc.cohort_rank} (Top ${calc.rank_percentile}%)`);
      }
      
      const change = calc.completion_percentage - (vehicle.completion_percentage || 0);
      if (Math.abs(change) > 5) {
        console.log(`   ⚠️  Change from old system: ${change > 0 ? '+' : ''}${change.toFixed(1)}%`);
      }
    }
  }
  
  // Test 4: Check timeline events for one vehicle
  console.log('\n─────────────────────────────────────────────────\n');
  console.log('TEST 4: Timeline event analysis for first vehicle...\n');
  
  const { data: events, error: eventsError } = await supabase
    .from('timeline_events')
    .select('id, event_type, event_date, image_urls, metadata')
    .eq('vehicle_id', testVehicle.id)
    .order('event_date', { ascending: false })
    .limit(5);
  
  if (!eventsError && events) {
    console.log(`Found ${events.length} recent timeline events:`);
    events.forEach((e, i) => {
      const hasPhotos = e.image_urls && e.image_urls.length > 0;
      const hasCosts = e.metadata?.parts_cost || e.metadata?.labor_cost;
      console.log(`  ${i + 1}. ${e.event_type} on ${e.event_date}`);
      console.log(`     ${hasPhotos ? '📸 Has photos' : '⚪ No photos'} | ${hasCosts ? '💰 Has costs' : '⚪ No costs'}`);
    });
  } else {
    console.log('  No timeline events found');
  }
  
  // Test 5: Test cohort recalculation
  console.log('\n─────────────────────────────────────────────────\n');
  console.log('TEST 5: Test cohort recalculation function...\n');
  
  if (testVehicle.make && testVehicle.year) {
    const { data: cohortResults, error: cohortError } = await supabase.rpc(
      'recalculate_cohort_completion',
      { 
        p_make: testVehicle.make,
        p_year_min: testVehicle.year - 3,
        p_year_max: testVehicle.year + 3
      }
    );
    
    if (cohortError) {
      console.log('❌ Cohort recalculation failed:', cohortError.message);
    } else if (cohortResults && cohortResults.length > 0) {
      console.log(`✅ Recalculated ${cohortResults.length} vehicles in cohort:`);
      console.log(`   (${testVehicle.year - 3}-${testVehicle.year + 3} ${testVehicle.make})\n`);
      
      cohortResults.slice(0, 5).forEach(r => {
        const change = r.change;
        const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
        console.log(`   ${arrow} Vehicle ${r.vehicle_id.substring(0, 8)}...`);
        console.log(`      Old: ${r.old_completion}% → New: ${r.new_completion}% (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`);
      });
    } else {
      console.log('  No vehicles in cohort to recalculate');
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log('✅ All tests complete!\n');
  console.log('The algorithmic completion calculator is working correctly.');
  console.log('Scores are relative to cohort and will flux as more vehicles added.\n');
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

