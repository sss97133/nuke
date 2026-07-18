import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { count, error: cErr } = await sb.from('vehicle_observations').select('*', { count: 'exact', head: true });
console.log('total rows in vehicle_observations:', count, 'cErr:', cErr?.message);
const seen = new Set();
const { data, error } = await sb.from('vehicle_observations').select('kind').limit(1000);
console.log('first-1000 err:', error?.message, 'rowcount:', data?.length);
for (const r of (data || [])) seen.add(r.kind);
console.log('kinds in first 1000:', [...seen].sort());
// K5 specifically
const VEHICLE_ID = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
const { data: k5, error: kErr } = await sb.from('vehicle_observations').select('kind').eq('vehicle_id', VEHICLE_ID).limit(1000);
console.log('k5 err:', kErr?.message, 'k5 rowcount:', k5?.length);
const k5Kinds = new Set((k5 || []).map((r) => r.kind));
console.log('K5 kinds:', [...k5Kinds].sort());
