import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const id = process.argv[2];
const { data, error } = await sb
  .from('vehicle_images')
  .select('id, file_name, taken_at, ai_scan_metadata')
  .eq('id', id)
  .maybeSingle();
if (error) { console.error(error); process.exit(1); }
console.log('id:        ', data.id);
console.log('file_name: ', data.file_name);
console.log('taken_at:  ', data.taken_at);
console.log('metadata top-level keys: ', Object.keys(data.ai_scan_metadata || {}));
console.log('has byok_deep_analysis:  ', !!(data.ai_scan_metadata?.byok_deep_analysis));
console.log('\n--- ai_scan_metadata (pretty) ---');
console.log(JSON.stringify(data.ai_scan_metadata, null, 2));
