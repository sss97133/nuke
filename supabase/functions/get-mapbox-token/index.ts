import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const token = Deno.env.get('MAPBOX_TOKEN')
  
  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Mapbox token not configured' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  }

  return new Response(
    JSON.stringify({ secret: token }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})