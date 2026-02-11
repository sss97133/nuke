import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  try {
    // Auth: get user from JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { deal_id, storage_path, original_filename, page_number } = await req.json()

    if (!deal_id || !storage_path) {
      return new Response(JSON.stringify({ error: 'Missing deal_id or storage_path' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verify deal belongs to user
    const { data: deal, error: dealErr } = await supabase
      .from('ds_deals')
      .select('id, user_id')
      .eq('id', deal_id)
      .eq('user_id', user.id)
      .single()

    if (dealErr || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Deduct credit (atomic)
    const { data: creditResult } = await supabase.rpc('ds_deduct_credit', {
      p_user_id: user.id,
      p_description: `Extract page for deal ${deal_id}`
    })

    const credit = creditResult?.[0]
    if (!credit?.success) {
      return new Response(JSON.stringify({
        error: 'Insufficient credits',
        credits_remaining: 0,
        message: 'Purchase more extraction credits to continue.'
      }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create document page record
    const { data: page, error: pageErr } = await supabase
      .from('ds_document_pages')
      .insert({
        deal_id,
        user_id: user.id,
        storage_path,
        original_filename: original_filename || null,
        page_number: page_number || 1,
        review_status: 'pending',
      })
      .select('id')
      .single()

    if (pageErr) {
      // Refund credit on failure
      const { error: refundError } = await supabase.rpc('ds_refund_credit', { p_user_id: user.id, p_description: 'Page creation failed' })
      if (refundError) console.error('CRITICAL: Failed to refund credit:', refundError.message)
      throw new Error(`Failed to create page: ${pageErr.message}`)
    }

    // Update deal page count
    const { error: updateError } = await supabase.from('ds_deals')
      .update({
        total_pages: deal.total_pages ? deal.total_pages + 1 : 1,
        status: 'processing',
        updated_at: new Date().toISOString()
      })
      .eq('id', deal_id)
    if (updateError) console.error('Failed to update deal:', updateError.message)

    // Generate signed URL for the image
    const { data: signedUrl } = await supabase.storage
      .from('dealerscan-documents')
      .createSignedUrl(storage_path, 300) // 5 min

    if (!signedUrl?.signedUrl) {
      const { error: refundError } = await supabase.rpc('ds_refund_credit', { p_user_id: user.id, p_description: 'Failed to get signed URL' })
      if (refundError) console.error('CRITICAL: Failed to refund credit:', refundError.message)
      throw new Error('Failed to generate signed URL')
    }

    // Call extraction function
    const extractResp = await fetch(`${supabaseUrl}/functions/v1/ds-extract-document`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`
      },
      body: JSON.stringify({ image_url: signedUrl.signedUrl })
    })

    if (!extractResp.ok) {
      const errText = await extractResp.text()
      // Refund credit on extraction failure
      const { error: refundError } = await supabase.rpc('ds_refund_credit', { p_user_id: user.id, p_description: 'Extraction failed' })
      if (refundError) console.error('CRITICAL: Failed to refund credit:', refundError.message)

      await supabase.from('ds_document_pages').update({
        review_status: 'pending',
        extracted_data: { error: errText.substring(0, 500) },
      }).eq('id', page.id)

      throw new Error(`Extraction failed: ${errText.substring(0, 200)}`)
    }

    const extractResult = await extractResp.json()

    // Update the page with extraction results
    const needsReview = extractResult._needs_review || false
    const reviewStatus = needsReview ? 'pending' : 'auto_accepted'

    await supabase.from('ds_document_pages').update({
      document_type: extractResult.document_type || 'other',
      document_type_confidence: extractResult.document_type_confidence || 0,
      extracted_data: extractResult.extracted_data || extractResult,
      confidences: extractResult.confidences || {},
      raw_ocr_text: extractResult.raw_ocr_text || null,
      extraction_provider: extractResult._provider,
      extraction_model: extractResult._model,
      extraction_cost_usd: extractResult._cost_usd,
      extraction_duration_ms: extractResult._duration_ms,
      needs_review: needsReview,
      review_status: reviewStatus,
      extracted_at: new Date().toISOString(),
    }).eq('id', page.id)

    // Update deal counters
    const updateFields: any = {
      pages_extracted: (deal.pages_extracted || 0) + 1,
      updated_at: new Date().toISOString()
    }
    if (needsReview) {
      updateFields.pages_needing_review = (deal.pages_needing_review || 0) + 1
      updateFields.status = 'review'
    }
    await supabase.from('ds_deals').update(updateFields).eq('id', deal_id)

    return new Response(JSON.stringify({
      page_id: page.id,
      document_type: extractResult.document_type,
      needs_review: needsReview,
      review_reasons: extractResult._review_reasons || [],
      credits_remaining: credit.credits_remaining,
      credit_source: credit.source,
      extracted_data: extractResult.extracted_data || extractResult,
      confidences: extractResult.confidences || {},
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Upload and extract error:', error)
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
