import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
  const svcKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? '';
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  
  return new Response(JSON.stringify({
    supabase_url: url,
    service_key_prefix: svcKey.slice(0, 20),
    service_key_length: svcKey.length,
    service_key_is_jwt: svcKey.startsWith('eyJ'),
    anon_key_prefix: anonKey.slice(0, 20),
    anon_key_length: anonKey.length,
    anon_key_is_jwt: anonKey.startsWith('eyJ'),
  }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});


