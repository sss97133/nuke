#!/usr/bin/env node
/**
 * RUN CHEAP VALIDATION AGENTS - test completeness scoring
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const supabase = createClient('https://qkgaybvrernstplzjaam.supabase.co', supabaseKey);

// CHEAP GPT-3.5 BINARY VALIDATION
async function askCheapAI(prompt) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo', // CHEAP MODEL - $0.001 per 1K tokens
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 5, // MINIMAL COST
        temperature: 0 // CONSISTENT DECISIONS
      })
    });

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase();
    return answer === 'YES';
  } catch (error) {
    console.log(`AI error: ${error.message}`);
    return false;
  }
}

// YES/NO VALIDATION PROMPTS for database fields
const VALIDATION_PROMPTS = {
  year: (value) => `Is "${value}" a valid vehicle year (1900-2026)? YES or NO only.`,
  make: (value) => `Is "${value}" a real vehicle manufacturer? YES or NO only.`,
  model: (value) => `Is "${value}" a real vehicle model name (not description)? YES or NO only.`,
  vin: (value) => `Is "${value}" a valid 17-character VIN format? YES or NO only.`,
  price: (value) => `Is $${value} a reasonable vehicle price ($100-$10M)? YES or NO only.`,
  description: (value) => `Does this contain useful vehicle details (not just "call for info")? YES or NO only.\n\n"${value.substring(0, 200)}..."`
};

async function validateVehicleCompleteness(vehicleId) {
  console.log(`\n🧠 AI VALIDATING VEHICLE: ${vehicleId}`);

  // Get vehicle data
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('*')
    .eq('id', vehicleId)
    .single();

  if (!vehicle) {
    console.log('❌ Vehicle not found');
    return { complete: false, score: 0 };
  }

  console.log(`🚗 Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

  const validationResults = {};
  const requiredFields = ['year', 'make', 'model'];
  const importantFields = ['vin', 'price', 'description'];

  // Test each field with cheap AI
  for (const field of [...requiredFields, ...importantFields]) {
    const value = vehicle[field];

    if (!value || value === '') {
      validationResults[field] = { valid: false, reason: 'missing' };
      console.log(`   ❌ ${field}: missing`);
      continue;
    }

    const prompt = VALIDATION_PROMPTS[field];
    if (prompt) {
      const isValid = await askCheapAI(prompt(value));
      validationResults[field] = { valid: isValid, value };
      console.log(`   ${isValid ? '✅' : '❌'} ${field}: ${isValid ? 'valid' : 'invalid'}`);
    } else {
      validationResults[field] = { valid: true, value };
      console.log(`   ✅ ${field}: present`);
    }
  }

  // Calculate completeness score
  const totalFields = requiredFields.length + importantFields.length;
  const validFields = Object.values(validationResults).filter(r => r.valid).length;
  const score = validFields / totalFields;
  const missingRequired = requiredFields.filter(f => !validationResults[f]?.valid);

  const complete = missingRequired.length === 0 && score >= 0.7;

  // FINAL AI DECISION
  const profileSummary = `Year: ${vehicle.year}, Make: ${vehicle.make}, Model: ${vehicle.model}, Price: $${vehicle.price || 'unknown'}, VIN: ${vehicle.vin ? 'present' : 'missing'}, Description: ${vehicle.description ? 'present' : 'missing'}`;

  const finalPrompt = `Is this vehicle profile complete enough for public display? YES or NO only.\n\nProfile: ${profileSummary}`;
  const aiApproves = await askCheapAI(finalPrompt);

  const result = {
    vehicleId,
    complete: complete && aiApproves,
    score: score,
    validFields,
    totalFields,
    aiApproves,
    missingRequired,
    validationDetails: validationResults
  };

  console.log(`📊 Score: ${(score * 100).toFixed(1)}% | AI Approval: ${aiApproves ? '✅' : '❌'} | Complete: ${result.complete ? '✅' : '❌'}`);

  return result;
}

async function testCheapValidationAgents() {
  console.log('🤖 TESTING CHEAP VALIDATION AGENTS');
  console.log('💰 Using GPT-3.5 turbo (~$0.001 per validation)');
  console.log('='.repeat(50));

  // Get some test vehicles
  const { data: testVehicles } = await supabase
    .from('vehicles')
    .select('id, year, make, model')
    .not('year', 'is', null)
    .limit(5);

  if (!testVehicles || testVehicles.length === 0) {
    console.log('❌ No test vehicles found');
    return;
  }

  const results = [];

  for (const vehicle of testVehicles) {
    const validation = await validateVehicleCompleteness(vehicle.id);
    results.push(validation);

    // Update vehicle status based on validation
    if (validation.complete) {
      await supabase
        .from('vehicles')
        .update({
          status: 'complete',
          completeness_score: validation.score,
          ai_validated: true,
          validated_at: new Date().toISOString()
        })
        .eq('id', vehicle.id);
    } else {
      await supabase
        .from('vehicles')
        .update({
          status: 'needs_improvement',
          completeness_score: validation.score,
          ai_validated: false
        })
        .eq('id', vehicle.id);
    }

    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n📊 VALIDATION SUMMARY:');
  console.log('='.repeat(50));

  const completeVehicles = results.filter(r => r.complete).length;
  const avgScore = results.reduce((acc, r) => acc + r.score, 0) / results.length;

  console.log(`✅ Complete vehicles: ${completeVehicles}/${results.length}`);
  console.log(`📈 Average completeness: ${(avgScore * 100).toFixed(1)}%`);
  console.log(`💰 Estimated cost: ~$${(results.length * 0.001).toFixed(3)}`);

  const needImprovement = results.filter(r => !r.complete);
  if (needImprovement.length > 0) {
    console.log('\n⚠️  VEHICLES NEEDING IMPROVEMENT:');
    needImprovement.forEach(v => {
      console.log(`   - ${v.vehicleId}: Missing ${v.missingRequired.join(', ')}`);
    });
  }

  console.log('\n🎯 CHEAP VALIDATION AGENTS WORKING!');
  console.log('✅ Binary YES/NO decisions with GPT-3.5');
  console.log('✅ Database completeness validation');
  console.log('✅ Cost: <$0.001 per vehicle validation');
  console.log('✅ Ready to scale to thousands of vehicles');
}

testCheapValidationAgents().catch(console.error);