// Supabase Edge Function: apple-upload
// Accepts multipart/form-data from iOS Shortcut or macOS helper
// Fields:
// - vehicle_id (string, required)
// - album (string, optional)
// - type ("life" | "work" | event_type string, optional, default "life")
// - stage (string, optional)
// - event_date (YYYY-MM-DD, optional; if provided, overrides EXIF dates)
// - lat (number, optional), lon (number, optional)
// - files[] (binary images)
// Behavior:
// - Extracts EXIF dateTimeOriginal from each image
// - Groups images by date
// - Creates separate vehicle_timeline_events for each date group
// - Creates vehicle_images rows with taken_at from EXIF
// - Adds user_activity entries

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import exifr from 'npm:exifr@7.1.3'

const STORAGE_BUCKET = 'vehicle-data'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

function badRequest(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { 'content-type': 'application/json', ...corsHeaders } })
}

interface FileWithMetadata {
  file: File
  exifDate: Date | null
  dateString: string | null
}

function isValidDate(date: Date | null): boolean {
  if (!date) return false
  const timestamp = date.getTime()
  // Must be after 1970 and not in the future
  return timestamp > 0 && date < new Date()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = req.headers.get('authorization') || ''
    if (!auth.startsWith('Bearer ')) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
    const jwt = auth.substring('Bearer '.length)

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) return badRequest('Expected multipart/form-data')

    const form = await req.formData()
    const vehicleId = String(form.get('vehicle_id') || '')
    if (!vehicleId) return badRequest('vehicle_id required')
    
    const album = String(form.get('album') || '')
    const type = String(form.get('type') || 'life')
    const stage = String(form.get('stage') || '')
    const explicitEventDate = form.get('event_date') ? String(form.get('event_date')) : null
    const lat = form.get('lat') ? Number(form.get('lat')) : undefined
    const lon = form.get('lon') ? Number(form.get('lon')) : undefined

    // Collect files
    const files: File[] = []
    for (const [key, value] of form.entries()) {
      if (value instanceof File) files.push(value)
    }
    if (files.length === 0) return badRequest('No files provided')

    console.log(`Processing ${files.length} files for vehicle ${vehicleId}`)

    // Supabase client
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabaseUrl = Deno.env.get('PROJECT_URL')!
    const supabaseAnonKey = Deno.env.get('ANON_KEY')!
    const supabaseServiceKey = Deno.env.get('SERVICE_ROLE_KEY') || supabaseAnonKey
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } }
    })

    // Resolve the authenticated user (for attribution). Many downstream UIs rely on user_id being present.
    const { data: userRes, error: userErr } = await supabase.auth.getUser()
    const authedUserId = !userErr ? (userRes?.user?.id || null) : null
    if (!authedUserId) {
      return new Response(JSON.stringify({ error: 'Unable to resolve authenticated user' }), {
        status: 401,
        headers: { 'content-type': 'application/json', ...corsHeaders }
      })
    }

    // CRITICAL: Verify vehicle exists before processing
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('id', vehicleId)
      .single()
    
    if (vehicleError || !vehicle) {
      return badRequest(`Vehicle ${vehicleId} does not exist. Create vehicle first before uploading photos.`)
    }

    console.log(`Vehicle ${vehicleId} verified, proceeding with upload`)

    // Extract EXIF from all files
    const filesWithMetadata: FileWithMetadata[] = []
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const exif = await exifr.parse(arrayBuffer, { 
          pick: ['DateTimeOriginal', 'DateTime', 'CreateDate']
        })
        
        const exifDate = exif?.DateTimeOriginal || exif?.DateTime || exif?.CreateDate || null
        const dateString = exifDate && isValidDate(exifDate) 
          ? exifDate.toISOString().split('T')[0]
          : null
        
        filesWithMetadata.push({
          file,
          exifDate: isValidDate(exifDate) ? exifDate : null,
          dateString
        })
        
        if (dateString) {
          console.log(`  ${file.name}: EXIF date = ${dateString}`)
        } else {
          console.log(`  ${file.name}: No valid EXIF date`)
        }
      } catch (e) {
        console.error(`Failed to extract EXIF from ${file.name}:`, e)
        filesWithMetadata.push({ file, exifDate: null, dateString: null })
      }
    }

    // Group by date
    const dateGroups = new Map<string, FileWithMetadata[]>()
    
    if (explicitEventDate) {
      // If explicit date provided, use it for all files
      console.log(`Using explicit event_date: ${explicitEventDate}`)
      dateGroups.set(explicitEventDate, filesWithMetadata)
    } else {
      // Group by EXIF date, skip files without EXIF
      for (const item of filesWithMetadata) {
        if (item.dateString) {
          if (!dateGroups.has(item.dateString)) {
            dateGroups.set(item.dateString, [])
          }
          dateGroups.get(item.dateString)!.push(item)
        } else {
          console.log(`  Skipping timeline event for ${item.file.name} (no EXIF date)`)
        }
      }
    }

    console.log(`Created ${dateGroups.size} date group(s)`)

    const createdEvents: any[] = []
    let totalImagesUploaded = 0

    // Process each date group
    for (const [dateStr, groupFiles] of dateGroups.entries()) {
      console.log(`Processing ${groupFiles.length} files for date ${dateStr}`)

      // Create event for this date
      const eventTitle = album 
        ? `${groupFiles.length} photo${groupFiles.length > 1 ? 's' : ''} • ${album}`
        : `${groupFiles.length} photo${groupFiles.length > 1 ? 's' : ''}`

      const eventPayload: any = {
        vehicle_id: vehicleId,
        event_type: type === 'work' ? 'maintenance' : type,
        source: 'apple_import',
        event_date: dateStr,
        title: eventTitle,
        metadata: {
          album: album || undefined,
          stage: stage || undefined,
          category: type === 'life' ? 'life' : 'work',
          created_by: 'apple_import',
          photo_count: groupFiles.length,
          location_coords: lat !== undefined && lon !== undefined ? { latitude: lat, longitude: lon } : undefined,
          exif_verified: !explicitEventDate
        }
      }

      const { data: eventRec, error: eventErr } = await supabase
        .from('vehicle_timeline_events')
        .insert([eventPayload])
        .select()
        .single()

      if (eventErr) {
        console.error(`Failed to create event for ${dateStr}:`, eventErr.message)
        continue
      }

      console.log(`  Created event ${eventRec.id} for ${dateStr}`)

      // Upload files for this date group
      const uploadedUrls: string[] = []
      let idx = 0
      
      for (const item of groupFiles) {
        const ext = (item.file.name.split('.').pop() || 'jpg').toLowerCase()
        const fileName = `${Date.now()}_${idx++}.${ext}`
        const filePath = `vehicles/${vehicleId}/events/${eventRec.id}/${fileName}`
        
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, item.file)
        
        if (upErr) {
          console.error(`  Upload failed for ${fileName}:`, upErr.message)
          continue
        }

        const { data: pub } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(filePath)
        
        if (pub?.publicUrl) {
          uploadedUrls.push(pub.publicUrl)
          
          // Create vehicle_images record with EXIF date
          await supabase.from('vehicle_images').insert({
            vehicle_id: vehicleId,
            user_id: authedUserId,
            documented_by_user_id: authedUserId,
            image_url: pub.publicUrl,
            is_primary: false,
            is_document: false,
            is_duplicate: false,
            process_stage: stage || null,
            source: 'apple_import',
            source_url: album ? `apple_album:${album}` : 'apple_import',
            storage_path: filePath,
            file_name: fileName,
            timeline_event_id: eventRec.id,
            taken_at: item.exifDate ? item.exifDate.toISOString() : null
          })
          
          totalImagesUploaded++
        }
      }

      // Update event with image URLs
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

      console.log(`  Uploaded ${uploadedUrls.length} images for event ${eventRec.id}`)

      // Log user activity (optional - table may not exist)
      try {
        await supabase.from('user_activity').insert([
          {
            activity_type: 'created_event',
            vehicle_id: vehicleId,
            event_id: eventRec.id,
            title: `Created: ${eventRec.title}`,
            metadata: { 
              image_count: uploadedUrls.length, 
              source: 'apple_import',
              date: dateStr 
            }
          },
          {
            activity_type: 'photography',
            vehicle_id: vehicleId,
            event_id: eventRec.id,
            title: `Photographed ${uploadedUrls.length} image${uploadedUrls.length === 1 ? '' : 's'}`,
            metadata: { 
              image_count: uploadedUrls.length,
              date: dateStr
            }
          }
        ])
      } catch (activityError) {
        console.log('  Note: user_activity logging failed (table may not exist)')
      }

      createdEvents.push({
        event_id: eventRec.id,
        date: dateStr,
        image_count: uploadedUrls.length
      })
    }

    // Handle files without EXIF (uploaded but no timeline event)
    const filesWithoutDate = filesWithMetadata.filter(f => !f.dateString && !explicitEventDate)
    if (filesWithoutDate.length > 0) {
      console.log(`${filesWithoutDate.length} files uploaded without timeline event (no EXIF date)`)
      
      // Still upload these files, just without timeline event
      for (const item of filesWithoutDate) {
        const ext = (item.file.name.split('.').pop() || 'jpg').toLowerCase()
        const fileName = `${Date.now()}_no_date_${Math.random().toString(36).substr(2, 9)}.${ext}`
        const filePath = `vehicles/${vehicleId}/loose/${fileName}`
        
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, item.file)
        
        if (!upErr) {
          const { data: pub } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(filePath)
          
          if (pub?.publicUrl) {
            await supabase.from('vehicle_images').insert({
              vehicle_id: vehicleId,
              user_id: authedUserId,
              documented_by_user_id: authedUserId,
              image_url: pub.publicUrl,
              is_primary: false,
              is_document: false,
              is_duplicate: false,
              process_stage: stage || null,
              source: 'apple_import',
              source_url: album ? `apple_album:${album}` : 'apple_import',
              storage_path: filePath,
              file_name: fileName,
              taken_at: null
            })
            totalImagesUploaded++
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        events_created: createdEvents.length,
        total_images: totalImagesUploaded,
        events: createdEvents,
        files_without_exif: filesWithoutDate.length
      }),
      { headers: { 'content-type': 'application/json', ...corsHeaders } }
    )

  } catch (e: any) {
    console.error('apple-upload error:', e)
    return new Response(
      JSON.stringify({ error: e?.message || 'Unknown error' }),
      { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders } }
    )
  }
})
