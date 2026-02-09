import { getSupabase, getSupabaseUrl } from '../lib/supabase'
import type { Deal, DocumentPage, ExtractionResult } from '../types'

/** Company serial / ID used for folder naming (e.g. VLVA, stock number). Prefer from merged_data. */
function getDealSerial(deal: Deal): string {
  const merged = deal.merged_data as Record<string, unknown> | undefined
  const raw =
    (merged?.vlva as string) ??
    (merged?.stock_number as string) ??
    (merged?.company_serial as string) ??
    ''
  return String(raw ?? '').trim()
}

/** Full display name for a deal jacket: Year Make Model · company serial (e.g. VLVA) or VIN. Used for UI and folder naming. */
export function formatDealDisplayName(deal: Deal, totalDocs?: number): string {
  const merged = deal.merged_data as Record<string, unknown> | undefined
  const ymm =
    [deal.year, deal.make, deal.model].filter(Boolean).join(' ').trim() ||
    (merged?.year || merged?.make || merged?.model
      ? [merged.year, merged.make, merged.model].filter(Boolean).join(' ').trim()
      : '')
  const serial = getDealSerial(deal)
  const vin = (deal.vin || (merged?.vin as string) || '').trim()
  const idPart = serial || vin
  if (ymm && idPart) return `${ymm} · ${idPart}`
  if (ymm) return ymm
  if (idPart) return idPart
  if (deal.deal_name?.trim()) return deal.deal_name.trim()
  const n = totalDocs ?? deal.total_pages ?? 0
  return n > 0 ? `${n} deal jacket${n === 1 ? '' : 's'}` : 'Deal jacket'
}

/** Human-readable document type label (e.g. bill_of_sale → Bill of sale). */
export function formatDocumentType(type: string): string {
  return type
    .split(/[_\s]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Summary string for doc types: "Title (1), Bill of sale (2), Receipt (3)". Omit when only generic "document". */
export function formatDocumentTypeSummary(byType: Record<string, number>): string {
  const keys = Object.keys(byType).filter(k => (byType[k] || 0) > 0)
  const onlyGeneric = keys.length === 1 && (keys[0] || 'document').toLowerCase() === 'document'
  if (onlyGeneric) return ''
  const entries = Object.entries(byType)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${formatDocumentType(type || 'document')} (${count})`)
    .sort()
  return entries.join(', ')
}

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

export interface DealExternalImage {
  id: string
  deal_id: string
  image_url: string
  page_number: number
}

export async function getDealExternalImages(dealId: string): Promise<DealExternalImage[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('ds_deal_external_images')
    .select('id, deal_id, image_url, page_number')
    .eq('deal_id', dealId)
    .order('page_number', { ascending: true })

  if (error) throw new Error(error.message)
  return data || []
}

/** Document type counts per deal (for dashboard: "Title (1), Bill of sale (2), Receipt (3)"). */
export async function getDocumentTypeCountsForUser(): Promise<Record<string, { total: number; byType: Record<string, number> }>> {
  const supabase = getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}

  const { data: rows, error } = await supabase
    .from('ds_document_pages')
    .select('deal_id, document_type')
    .eq('user_id', user.id)

  if (error) return {}

  const out: Record<string, { total: number; byType: Record<string, number> }> = {}
  for (const row of rows || []) {
    const id = row.deal_id
    if (!out[id]) out[id] = { total: 0, byType: {} }
    out[id].total += 1
    const type = (row.document_type || 'document').trim() || 'document'
    out[id].byType[type] = (out[id].byType[type] || 0) + 1
  }
  return out
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

/** Connect external photo URLs to a deal (reference-only; no download). Creates a new deal if dealId omitted. */
export async function connectPhotos(
  urls: string[],
  dealId?: string
): Promise<{ deal_id: string }> {
  const supabase = getSupabase()
  const SUPABASE_URL = getSupabaseUrl()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Not authenticated')

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/ds-connect-photos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ urls, deal_id: dealId ?? undefined }),
  })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Connect photos failed')
  }
  return resp.json()
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

/** Bulk export: all deal jackets (deal + pages) as one JSON file for use in the framework. */
export async function exportAllDealsAsJson(): Promise<string> {
  const deals = await getDeals()
  const pagesByDeal = await Promise.all(deals.map((d) => getDealPages(d.id)))
  const deal_jackets = deals.map((deal, i) => {
    const pages = pagesByDeal[i] || []
    return {
      deal: {
        id: deal.id,
        deal_name: deal.deal_name,
        vin: deal.vin,
        year: deal.year,
        make: deal.make,
        model: deal.model,
        owner_name: deal.owner_name,
        sale_price: deal.sale_price,
        deal_date: deal.deal_date,
        merged_data: deal.merged_data,
        total_pages: deal.total_pages,
      },
      pages: pages.map((p) => ({
        document_type: p.document_type,
        extracted_data: { ...p.extracted_data, ...p.user_edits },
        original_filename: p.original_filename,
      })),
    }
  })
  return JSON.stringify(
    { exported_at: new Date().toISOString(), deal_jackets },
    null,
    2
  )
}
