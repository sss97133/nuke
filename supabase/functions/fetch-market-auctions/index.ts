import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('Fetching sample auction data...')
    
    // Sample data to test the UI
    const sampleData = [
      {
        make: "Porsche",
        model: "911",
        year: 1973,
        price: 150000,
        url: "https://bringatrailer.com/listing/1973-porsche-911",
        source: "bringatrailer",
        endTime: new Date(Date.now() + 86400000).toISOString(), // 24h from now
        imageUrl: "https://images.unsplash.com/photo-1580274455191-1c62238fa333?w=800"
      },
      {
        make: "BMW",
        model: "M3",
        year: 1988,
        price: 75000,
        url: "https://carsandbids.com/auctions/bmw-m3-e30",
        source: "carsandbids",
        endTime: new Date(Date.now() + 172800000).toISOString(), // 48h from now
        imageUrl: "https://images.unsplash.com/photo-1580274455191-1c62238fa333?w=800"
      },
      {
        make: "Ferrari",
        model: "Testarossa",
        year: 1989,
        price: 200000,
        url: "https://www.hagerty.com/marketplace/1989-ferrari-testarossa",
        source: "hagerty",
        imageUrl: "https://images.unsplash.com/photo-1580274455191-1c62238fa333?w=800"
      }
    ]

    console.log('Returning sample data:', sampleData)

    return new Response(
      JSON.stringify({
        success: true,
        data: sampleData
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      }
    )
  }
})