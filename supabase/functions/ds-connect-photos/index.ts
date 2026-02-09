import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function normalizeImageUrls(input: string[]): string[] {
  const seen = new Set<string>()
  return input
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => {
      if (!u) return false
      try {
        const url = new URL(u)
        if (!/^https?:$/i.test(url.protocol)) return false
        if (seen.has(u)) return false
        seen.add(u)
        return true
      } catch {
        return false
      }
    })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
    } = await userClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({}))
    const urls: string[] = Array.isArray(body.urls) ? body.urls : []
    const dealIdInput: string | undefined = body.deal_id

    const normalized = normalizeImageUrls(urls)
    if (normalized.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Provide at least one image URL (urls: string[])' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    let dealId: string

    if (dealIdInput) {
      const { data: deal, error } = await supabase
        .from('ds_deals')
        .select('id')
        .eq('id', dealIdInput)
        .eq('user_id', user.id)
        .single()
      if (error || !deal) {
        return new Response(JSON.stringify({ error: 'Deal not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      dealId = deal.id
    } else {
      const { data: newDeal, error } = await supabase
        .from('ds_deals')
        .insert({ user_id: user.id, deal_name: null })
        .select('id')
        .single()
      if (error || !newDeal) {
        return new Response(JSON.stringify({ error: 'Failed to create deal' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      dealId = newDeal.id
    }

    const rows = normalized.map((image_url, i) => ({
      deal_id: dealId,
      user_id: user.id,
      image_url,
      page_number: i + 1,
    }))

    const { error } = await supabase.from('ds_deal_external_images').insert(rows)
    if (error) {
      return new Response(
        JSON.stringify({ error: 'Failed to store image refs', details: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    return new Response(
      JSON.stringify({ deal_id: dealId }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (e) {
    console.error('Connect photos error:', e)
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
