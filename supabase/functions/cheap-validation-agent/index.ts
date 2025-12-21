import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// CHEAP MODEL BINARY VALIDATION PROMPTS
const VALIDATION_PROMPTS = {
  year: `Is this a valid vehicle year between 1900-2026? Answer only YES or NO.
Year to validate: {value}`,

  make: `Is this a valid vehicle manufacturer name? Answer only YES or NO.
Common makes: Ford, Chevrolet, BMW, Toyota, Honda, Mercedes, etc.
Value to validate: "{value}"`,

  model: `Is this a valid vehicle model name (not a description)? Answer only YES or NO.
Examples: "Mustang" (YES), "Camaro" (YES), "Beautiful car" (NO), "See description" (NO)
Value to validate: "{value}"`,

  vin: `Is this a valid 17-character VIN format? Answer only YES or NO.
VIN format: 17 alphanumeric characters (no I, O, Q)
Value to validate: "{value}"`,

  description: `Does this description contain useful vehicle information? Answer only YES or NO.
Good description should include vehicle details, condition, history, or features.
Avoid: "Call for details", "See photos", generic dealer text
Description to validate: "{value}"`,

  price: `Is this a reasonable vehicle price? Answer only YES or NO.
Reasonable range: $100 - $10,000,000
Value to validate: "{value}"`,

  completeness: `Based on this vehicle profile, is it ready for public display? Answer only YES or NO.
Requirements: Must have year, make, model, and either price OR indication it's sold/auction.
Profile: {profile}`
};

interface ValidationRequest {
  vehicleId: string;
  field?: string;
  value?: any;
  checkCompleteness?: boolean;
}

async function askCheapModel(prompt: string): Promise<boolean> {
  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      console.log('No OpenAI key - simulating validation');
      return Math.random() > 0.2; // 80% pass rate for testing
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo', // CHEAP MODEL
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 5, // MINIMAL TOKENS
        temperature: 0 // CONSISTENT ANSWERS
      })
    });

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase();

    return answer === 'YES';
  } catch (error) {
    console.error('Cheap model error:', error);
    return false; // Fail safe
  }
}

async function validateField(field: string, value: any): Promise<boolean> {
  if (!value || value === '' || value === null) return false;

  const prompt = VALIDATION_PROMPTS[field as keyof typeof VALIDATION_PROMPTS];
  if (!prompt) return true; // No validation rule = pass

  const filledPrompt = prompt.replace('{value}', String(value));
  return await askCheapModel(filledPrompt);
}

async function checkVehicleCompleteness(vehicle: any): Promise<{
  complete: boolean;
  missingFields: string[];
  score: number;
}> {
  const requiredFields = ['year', 'make', 'model'];
  const importantFields = ['vin', 'mileage', 'price', 'description'];
  const missingRequired = [];
  const missingImportant = [];

  // Check required fields
  for (const field of requiredFields) {
    if (!vehicle[field] || vehicle[field] === '') {
      missingRequired.push(field);
    }
  }

  // Check important fields
  for (const field of importantFields) {
    if (!vehicle[field] || vehicle[field] === '') {
      missingImportant.push(field);
    }
  }

  const totalFields = requiredFields.length + importantFields.length;
  const filledFields = totalFields - missingRequired.length - missingImportant.length;
  const score = filledFields / totalFields;

  const complete = missingRequired.length === 0 && score >= 0.7; // 70% completion

  return {
    complete,
    missingFields: [...missingRequired, ...missingImportant],
    score
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vehicleId, field, value, checkCompleteness }: ValidationRequest = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (checkCompleteness || !field) {
      // CHECK VEHICLE COMPLETENESS
      console.log(`🔍 Checking completeness for vehicle ${vehicleId}`);

      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId)
        .single();

      if (error || !vehicle) {
        throw new Error('Vehicle not found');
      }

      const completeness = await checkVehicleCompleteness(vehicle);

      // Ask cheap model for final decision
      const profileSummary = `Year: ${vehicle.year}, Make: ${vehicle.make}, Model: ${vehicle.model}, Price: ${vehicle.price || 'Not set'}, VIN: ${vehicle.vin || 'Not set'}, Description: ${vehicle.description ? 'Present' : 'Missing'}`;

      const finalPrompt = VALIDATION_PROMPTS.completeness.replace('{profile}', profileSummary);
      const aiApproved = await askCheapModel(finalPrompt);

      const result = {
        vehicleId,
        complete: completeness.complete && aiApproved,
        score: completeness.score,
        missingFields: completeness.missingFields,
        aiApproved,
        readyForPublic: completeness.complete && aiApproved
      };

      // Update vehicle status
      if (result.readyForPublic) {
        await supabase
          .from('vehicles')
          .update({
            status: 'complete',
            completeness_score: result.score,
            validated_at: new Date().toISOString()
          })
          .eq('id', vehicleId);

        console.log(`✅ Vehicle ${vehicleId} marked as complete`);
      } else {
        await supabase
          .from('vehicles')
          .update({
            status: 'incomplete',
            completeness_score: result.score
          })
          .eq('id', vehicleId);

        console.log(`⚠️  Vehicle ${vehicleId} needs improvement`);
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else {
      // VALIDATE SINGLE FIELD
      console.log(`🔍 Validating ${field} = "${value}"`);

      const isValid = await validateField(field, value);

      return new Response(JSON.stringify({
        field,
        value,
        valid: isValid,
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Validation failed:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});