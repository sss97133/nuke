#!/usr/bin/env node
/**
 * Test script for forensic data assignment system
 * 
 * Usage:
 *   node scripts/test-forensic-system.js <vehicle_id> [--field <field_name>] [--value <value>] [--source <source>]
 * 
 * Examples:
 *   node scripts/test-forensic-system.js <vehicle_id>
 *   node scripts/test-forensic-system.js <vehicle_id> --field drivetrain --value "4x4" --source "user_input"
 *   node scripts/test-forensic-system.js <vehicle_id> --analyze-all
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('   Set VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testForensicAssignment(vehicleId, fieldName, value, source, context) {
  console.log(`\n🔬 Testing Forensic Assignment:`);
  console.log(`   Vehicle: ${vehicleId}`);
  console.log(`   Field: ${fieldName}`);
  console.log(`   Value: ${value}`);
  console.log(`   Source: ${source}`);
  if (context) console.log(`   Context: ${context}`);
  
  const { data, error } = await supabase.rpc('assign_field_forensically', {
    p_vehicle_id: vehicleId,
    p_field_name: fieldName,
    p_value: value,
    p_context: context || null,
    p_source: source || 'user_input_unverified'
  });
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('\n📊 Result:');
  console.log(JSON.stringify(data, null, 2));
}

async function testDisambiguation(value, context, vehicleData) {
  console.log(`\n🔍 Testing Disambiguation:`);
  console.log(`   Value: ${value}`);
  console.log(`   Context: ${context || 'none'}`);
  
  const { data, error } = await supabase.rpc('disambiguate_value', {
    p_value: value,
    p_field_candidates: ['engine_displacement_cid', 'horsepower', 'exterior_color_code'],
    p_context: context || null,
    p_existing_vehicle_data: vehicleData || null
  });
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('\n📊 Results:');
  for (const row of data) {
    console.log(`   ${row.field}: ${row.confidence}% confidence - ${row.reasoning}`);
  }
}

async function testConsensus(vehicleId, fieldName) {
  console.log(`\n🤝 Testing Consensus Building:`);
  console.log(`   Vehicle: ${vehicleId}`);
  console.log(`   Field: ${fieldName}`);
  
  const { data, error } = await supabase.rpc('build_field_consensus', {
    p_vehicle_id: vehicleId,
    p_field_name: fieldName,
    p_auto_assign: false
  });
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('\n📊 Consensus Result:');
  console.log(JSON.stringify(data, null, 2));
}

async function testAnomalies(vehicleId) {
  console.log(`\n🚨 Testing Anomaly Detection:`);
  console.log(`   Vehicle: ${vehicleId}`);
  
  const { data, error } = await supabase.rpc('detect_data_anomalies', {
    p_vehicle_id: vehicleId
  });
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  if (data.length === 0) {
    console.log('✅ No anomalies detected');
    return;
  }
  
  console.log(`\n⚠️  Found ${data.length} anomaly(ies):`);
  for (const anomaly of data) {
    console.log(`\n   Field: ${anomaly.field}`);
    console.log(`   Issue: ${anomaly.anomaly}`);
    console.log(`   Severity: ${anomaly.severity}`);
    console.log(`   Recommendation: ${anomaly.recommendation}`);
  }
}

async function testModificationDetection(vehicleId, field, value) {
  console.log(`\n🔧 Testing Modification Detection:`);
  console.log(`   Vehicle: ${vehicleId}`);
  console.log(`   Field: ${field}`);
  console.log(`   Value: ${value}`);
  
  const { data, error } = await supabase.rpc('detect_modification', {
    p_vehicle_id: vehicleId,
    p_field: field,
    p_new_value: value,
    p_source: 'user_input_unverified'
  });
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  console.log('\n📊 Result:');
  console.log(JSON.stringify(data, null, 2));
  
  if (data.is_modification) {
    console.log('\n⚠️  MODIFICATION DETECTED!');
    console.log(`   Factory: ${data.factory_value}`);
    console.log(`   Current: ${data.current_value}`);
    console.log(`   Action: ${data.action}`);
  }
}

async function analyzeAllFields(vehicleId) {
  console.log(`\n🔬 Analyzing All Fields for Vehicle: ${vehicleId}\n`);
  
  // Get vehicle data
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error('❌ Vehicle not found:', vehicleError);
    return;
  }
  
  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`VIN: ${vehicle.vin || 'None'}\n`);
  
  // Analyze each field
  const fields = ['vin', 'year', 'make', 'model', 'drivetrain', 'transmission', 'engine_type', 'series', 'trim'];
  
  for (const field of fields) {
    const value = vehicle[field];
    if (!value) continue;
    
    console.log(`\n📋 Field: ${field} = ${value}`);
    
    // Check consensus
    const { data: consensus } = await supabase.rpc('build_field_consensus', {
      p_vehicle_id: vehicleId,
      p_field_name: field,
      p_auto_assign: false
    });
    
    if (consensus) {
      console.log(`   Consensus: ${consensus.consensus_value || 'none'} (${consensus.consensus_confidence || 0}% confidence)`);
      console.log(`   Action: ${consensus.action || 'unknown'}`);
    }
  }
  
  // Check anomalies
  await testAnomalies(vehicleId);
  
  // Show evidence summary
  const { data: evidence } = await supabase
    .from('field_evidence')
    .select('field_name, proposed_value, source_type, source_confidence, status')
    .eq('vehicle_id', vehicleId)
    .order('field_name', { ascending: true })
    .order('source_confidence', { ascending: false });
  
  if (evidence && evidence.length > 0) {
    console.log(`\n📚 Evidence Summary (${evidence.length} records):`);
    const byField = {};
    for (const e of evidence) {
      if (!byField[e.field_name]) byField[e.field_name] = [];
      byField[e.field_name].push(e);
    }
    
    for (const [field, records] of Object.entries(byField)) {
      console.log(`\n   ${field}:`);
      for (const r of records) {
        console.log(`     - ${r.proposed_value} (${r.source_type}, ${r.source_confidence}%, ${r.status})`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node scripts/test-forensic-system.js <vehicle_id> [options]');
    console.log('\nOptions:');
    console.log('  --field <name>     Field to test');
    console.log('  --value <value>    Value to assign');
    console.log('  --source <source>  Source type (default: user_input_unverified)');
    console.log('  --context <text>   Context for disambiguation');
    console.log('  --analyze-all      Analyze all fields for vehicle');
    console.log('  --test-disambiguate <value> [--context <text>]  Test disambiguation');
    console.log('  --test-consensus <field>  Test consensus building');
    console.log('  --test-anomalies   Test anomaly detection');
    console.log('  --test-modification <field> <value>  Test modification detection');
    process.exit(1);
  }
  
  const vehicleId = args[0];
  
  // Parse options
  const options = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--field' && args[i + 1]) {
      options.field = args[++i];
    } else if (args[i] === '--value' && args[i + 1]) {
      options.value = args[++i];
    } else if (args[i] === '--source' && args[i + 1]) {
      options.source = args[++i];
    } else if (args[i] === '--context' && args[i + 1]) {
      options.context = args[++i];
    } else if (args[i] === '--analyze-all') {
      options.analyzeAll = true;
    } else if (args[i] === '--test-disambiguate' && args[i + 1]) {
      options.testDisambiguate = args[++i];
    } else if (args[i] === '--test-consensus' && args[i + 1]) {
      options.testConsensus = args[++i];
    } else if (args[i] === '--test-anomalies') {
      options.testAnomalies = true;
    } else if (args[i] === '--test-modification' && args[i + 1] && args[i + 2]) {
      options.testModification = { field: args[++i], value: args[++i] };
    }
  }
  
  try {
    if (options.analyzeAll) {
      await analyzeAllFields(vehicleId);
    } else if (options.testDisambiguate) {
      await testDisambiguation(options.testDisambiguate, options.context);
    } else if (options.testConsensus) {
      await testConsensus(vehicleId, options.testConsensus);
    } else if (options.testAnomalies) {
      await testAnomalies(vehicleId);
    } else if (options.testModification) {
      await testModificationDetection(vehicleId, options.testModification.field, options.testModification.value);
    } else if (options.field && options.value) {
      await testForensicAssignment(
        vehicleId,
        options.field,
        options.value,
        options.source || 'user_input_unverified',
        options.context
      );
    } else {
      console.log('❌ Invalid arguments. Use --help for usage.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();

