import { getSupabase, getSupabaseUrl } from '../lib/supabase'
import type { Deal, DocumentPage, ExtractionResult } from '../types'

export async function createDeal(dealName?: string): Promise<Deal> {
  const supabase = getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('ds_deals')
    .insert({ user_id: user.id, deal_name: dealName || null })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function getDeals(): Promise<Deal[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('ds_deals')
    .select('*')
    .neq('status', 'archived')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data || []
}

export async function getDeal(id: string): Promise<Deal> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('ds_deals')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function getDealPages(dealId: string): Promise<DocumentPage[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('ds_document_pages')
    .select('*')
    .eq('deal_id', dealId)
    .order('page_number', { ascending: true })

  if (error) throw new Error(error.message)
  return data || []
}

export async function uploadAndExtract(
  dealId: string,
  file: File,
  pageNumber: number,
  onProgress?: (pct: number) => void,
): Promise<ExtractionResult> {
  const supabase = getSupabase()
  const SUPABASE_URL = getSupabaseUrl()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const storagePath = `${user.id}/${dealId}/${crypto.randomUUID()}.${ext}`

  onProgress?.(10)

  const { error: uploadErr } = await supabase.storage
    .from('dealerscan-documents')
    .upload(storagePath, file, { contentType: file.type })

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

  onProgress?.(40)

  const { data: { session } } = await supabase.auth.getSession()
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/ds-upload-and-extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({
      deal_id: dealId,
      storage_path: storagePath,
      original_filename: file.name,
      page_number: pageNumber,
    }),
  })

  onProgress?.(90)

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Unknown error' }))
    if (resp.status === 402) {
      throw new Error('NO_CREDITS')
    }
    throw new Error(err.error || `Extraction failed: ${resp.status}`)
  }

  onProgress?.(100)
  return await resp.json()
}

export async function updatePageReview(
  pageId: string,
  edits: Record<string, any>,
): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('ds_document_pages')
    .update({
      user_edits: edits,
      review_status: 'user_reviewed',
      needs_review: false,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', pageId)

  if (error) throw new Error(error.message)
}

export async function getPageSignedUrl(storagePath: string): Promise<string> {
  const supabase = getSupabase()
  const { data } = await supabase.storage
    .from('dealerscan-documents')
    .createSignedUrl(storagePath, 3600)

  if (!data?.signedUrl) throw new Error('Failed to get image URL')
  return data.signedUrl
}

export async function mergeDeal(dealId: string): Promise<any> {
  const supabase = getSupabase()
  const SUPABASE_URL = getSupabaseUrl()

  const { data: { session } } = await supabase.auth.getSession()
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/ds-merge-deal-data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ deal_id: dealId }),
  })

  if (!resp.ok) throw new Error('Merge failed')
  return await resp.json()
}

export async function archiveDeal(dealId: string): Promise<void> {
  const supabase = getSupabase()
  const { error } = await supabase
    .from('ds_deals')
    .update({ status: 'archived' })
    .eq('id', dealId)

  if (error) throw new Error(error.message)
}

export function exportDealAsJson(deal: Deal, pages: DocumentPage[]): string {
  const exportData = {
    deal: {
      name: deal.deal_name,
      vin: deal.vin,
      year: deal.year,
      make: deal.make,
      model: deal.model,
      owner: deal.owner_name,
      sale_price: deal.sale_price,
      deal_date: deal.deal_date,
      merged_data: deal.merged_data,
    },
    pages: pages.map(p => ({
      document_type: p.document_type,
      extracted_data: { ...p.extracted_data, ...p.user_edits },
      original_filename: p.original_filename,
    })),
    exported_at: new Date().toISOString(),
  }
  return JSON.stringify(exportData, null, 2)
}

export function exportDealAsCsv(deal: Deal): string {
  const data = deal.merged_data || {}
  const rows = Object.entries(data)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `"${k}","${String(v ?? '').replace(/"/g, '""')}"`)

  return 'Field,Value\n' + rows.join('\n')
}
