// Supabase Edge Function: apple-upload
// Accepts multipart/form-data from iOS Shortcut or macOS helper
// Fields:
// - vehicle_id (string, required)
// - album (string, optional)
// - type ("life" | "work" | event_type string, optional, default "life")
// - stage (string, optional)
// - event_date (YYYY-MM-DD, optional; defaults to today)
// - lat (number, optional), lon (number, optional)
// - files[] (binary images)
// Behavior:
// - Stores files in storage bucket 'vehicle-images' at vehicles/<vehicle_id>/events/<event_id>/<file>
// - Creates vehicle_timeline_events row with image_urls, metadata incl. album, coords, counts
// - Creates vehicle_images rows
// - Adds user_activity created_event + photography

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = req.headers.get('authorization') || ''
    if (!auth.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    const jwt = auth.substring('Bearer '.length)

    const url = new URL(req.url)
    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) return badRequest('Expected multipart/form-data')

    const form = await req.formData()
    const vehicleId = String(form.get('vehicle_id') || '')
    if (!vehicleId) return badRequest('vehicle_id required')
    const album = String(form.get('album') || '')
    const type = String(form.get('type') || 'life') // life/work or any valid event_type
    const stage = String(form.get('stage') || '')
    const eventDate = String(form.get('event_date') || new Date().toISOString().split('T')[0])
    const lat = form.get('lat') ? Number(form.get('lat')) : undefined
    const lon = form.get('lon') ? Number(form.get('lon')) : undefined

    const files: File[] = []
    for (const [key, value] of form.entries()) {
      if (value instanceof File) files.push(value)
    }
    if (files.length === 0) return badRequest('No files provided')

    // Supabase clients
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabaseUrl = Deno.env.get('PROJECT_URL')!
    const supabaseAnonKey = Deno.env.get('ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY') || supabaseAnonKey
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }
    })

    // Create event first
    const eventPayload: any = {
      vehicle_id: vehicleId,
      event_type: type === 'work' ? 'maintenance' : type, // map "work" alias to maintenance
      source: 'apple_import',
      event_date: eventDate,
      title: album ? `Photo set • ${album}` : 'Photo set',
      metadata: {
        album: album || undefined,
        stage: stage || undefined,
        category: type === 'life' ? 'life' : 'work',
        created_by: 'apple_import',
        location_coords: lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : undefined
      }
    }

    const { data: eventRec, error: eventErr } = await supabase
      .from('vehicle_timeline_events')
      .insert([eventPayload])
      .select()
      .single()
    if (eventErr) return badRequest(`DB error creating event: ${eventErr.message}`)

    const uploadedUrls: string[] = []
    let idx = 0
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const fileName = `${Date.now()}_${idx++}.${ext}`
      const filePath = `vehicles/${vehicleId}/events/${eventRec.id}/${fileName}`
      const { error: upErr } = await supabase.storage.from('vehicle-images').upload(filePath, file)
      if (upErr) continue
      const { data: pub } = supabase.storage.from('vehicle-images').getPublicUrl(filePath)
      if (pub?.publicUrl) {
        uploadedUrls.push(pub.publicUrl)
        // create vehicle_images
        await supabase.from('vehicle_images').insert({
          vehicle_id: vehicleId,
          image_url: pub.publicUrl,
          is_primary: false,
          process_stage: stage || null
        })
      }
    }

    // Update event with images and counts
    await supabase
      .from('vehicle_timeline_events')
      .update({
        image_urls: uploadedUrls,
        metadata: {
          ...(eventRec.metadata || {}),
          uploaded_images: uploadedUrls.length
        }
      })
      .eq('id', eventRec.id)

    // user_activity entries (created_event & photography)
    await supabase.from('user_activity').insert([
      { activity_type: 'created_event', vehicle_id: vehicleId, event_id: eventRec.id, title: eventRec.title, metadata: { image_count: uploadedUrls.length, source: 'apple_import' } },
      { activity_type: 'photography', vehicle_id: vehicleId, event_id: eventRec.id, title: `Photographed ${uploadedUrls.length} image${uploadedUrls.length===1?'':'s'}`, metadata: { image_count: uploadedUrls.length } }
    ])

    return new Response(JSON.stringify({ event_id: eventRec.id, image_count: uploadedUrls.length }), { headers: { 'content-type': 'application/json', ...corsHeaders } })
  } catch (e: any) {
    console.error('apple-upload error:', e)
    return new Response(JSON.stringify({ error: e?.message || 'Unknown error' }), { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } })
  }
})
