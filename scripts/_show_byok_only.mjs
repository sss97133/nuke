import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await sb
  .from('vehicle_images')
  .select('ai_scan_metadata')
  .eq('id', process.argv[2])
  .maybeSingle();
console.log(JSON.stringify(data.ai_scan_metadata?.byok_deep_analysis, null, 2));
