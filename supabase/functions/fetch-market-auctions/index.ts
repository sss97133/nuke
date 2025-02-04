import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // This is a mock response for now - you can integrate with real auction APIs later
    const mockData = {
      data: [
        {
          make: "Toyota",
          model: "Supra",
          year: 1994,
          price: 45000,
          url: "https://example.com/auction/1",
          source: "Example Auctions",
          endTime: new Date(Date.now() + 86400000).toISOString(),
          imageUrl: "https://example.com/supra.jpg"
        },
        {
          make: "Nissan",
          model: "Skyline",
          year: 1999,
          price: 55000,
          url: "https://example.com/auction/2",
          source: "Example Auctions",
          endTime: new Date(Date.now() + 172800000).toISOString(),
          imageUrl: "https://example.com/skyline.jpg"
        }
      ]
    };

    return new Response(
      JSON.stringify(mockData),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})