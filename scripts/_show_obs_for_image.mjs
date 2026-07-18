import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const imageId = process.argv[2];
const { data: witnesses } = await sb
  .from('observation_witnesses')
  .select('observation_id, witness_role, capture_method, added_by_agent_key, attestation_notes')
  .eq('image_id', imageId);
console.log('--- observation_witnesses linking this image ---');
console.log(JSON.stringify(witnesses, null, 2));
if (witnesses?.length) {
  for (const w of witnesses) {
    const { data: obs } = await sb
      .from('vehicle_observations')
      .select('id, kind, observed_at, confidence, confidence_score, content_text, structured_data, ingested_at')
      .eq('id', w.observation_id)
      .maybeSingle();
    console.log('\n--- vehicle_observation row', w.observation_id, '---');
    console.log(JSON.stringify(obs, null, 2));
  }
}
