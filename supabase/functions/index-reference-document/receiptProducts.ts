import { retainImage } from '../_shared/catalogStockImage.ts';
export { allowedStockImage } from '../_shared/catalogStockImage.ts';
import { archiveFetch, retainFetchedCapture } from '../_shared/archiveFetch.ts';
import { allowedProductUrl, normalizePart, parseProductPage, productEligible, productLinks, receiptLineCode, supplierCandidates, supplierKey } from '../_shared/receiptProductCapture.mjs';

const sha = async (value: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value as BufferSource)), x => x.toString(16).padStart(2, '0')).join('');
const uuid = /^[0-9a-f-]{36}$/i;

/** Public supplier pages only. Receipt descriptions and owner details never leave Nuke. */
export async function capturePage(admin: any, url: string) {
  if (!allowedProductUrl(url)) throw new Error('supplier_url_unapproved');
  const result = await archiveFetch(url, { platform: 'receipt-products', maxAgeSec: 604800,
    firecrawlOnBlock: true, directFetchOptions: { publicOnly: true, retries: 0, timeout: 12000 },
    callerName: 'receipt-products-v1' });
  if (!result.html || result.error || result.archiveError) throw new Error(result.error?.includes('allowance') ? 'supplier_budget_deferred' : 'supplier_capture_unavailable');
  let snapshot = result.snapshotId;
  if (!snapshot) {
    // A duplicate capture is acknowledged against its retained bytes, never invented.
    const ack = await retainFetchedCapture(admin, { platform: 'receipt-products', url, html: result.html,
      httpStatus: result.statusCode, fetchedAt: new Date().toISOString() });
    if (ack.status !== 'retained' && ack.status !== 'existing') throw new Error('capture_not_retained');
    snapshot = ack.snapshot_id;
  }
  const { data: source, error } = await admin.from('listing_page_snapshots')
    .select('id,listing_url,html_sha256,http_status,success,fetched_at').eq('id', snapshot).single();
  if (error || !source?.success || source.http_status !== 200 || source.html_sha256 !== await sha(new TextEncoder().encode(result.html))) throw new Error('capture_readback_mismatch');
  return { html: result.html, source };
}


export async function enrichReceiptProducts(admin: any, body: any, effects = { capturePage, retainImage }) {
  if (!uuid.test(body.receipt_id ?? '') || !uuid.test(body.derivation_queue_id ?? '') || !body.worker) throw new Error('invalid_receipt_product_request');
  const queue = await admin.from('derivation_queue').select('id,user_id,evidence_id,product_result,product_generation')
    .eq('id', body.derivation_queue_id).eq('extractor_slug', 'receipt-products-v1').eq('status', 'claimed').eq('locked_by', body.worker).single();
  if (queue.error || queue.data.evidence_id !== body.receipt_id) throw new Error('receipt_product_lease_unavailable');
  const r = await admin.from('receipts').select('id,vendor_name,user_id,created_by,is_superseded,duplicate_of').eq('id', body.receipt_id).single();
  if (r.error || (r.data.user_id ?? r.data.created_by) !== queue.data.user_id) throw new Error('receipt_owner_mismatch');
  const receipt = r.data, outcomes: Record<string, any> = {};
  const reply = (complete: boolean, retry: number) => ({ success: true, product_complete: complete, source_receipt_id: receipt.id,
    generation: queue.data.product_generation, retry_after_seconds: retry, product_result: { items: outcomes, checked_at: new Date().toISOString() } });
  if (receipt.is_superseded || receipt.duplicate_of) return reply(true, 0);
  const lines = await admin.from('receipt_items').select('id,part_number,description').eq('receipt_id', receipt.id).order('id');
  if (lines.error) throw new Error('receipt_lines_unavailable');
  let processed = 0, complete = true, nextRetry = 604800;
  const blockedHosts = new Set<string>();
  for (const line of lines.data.filter(productEligible)) {
    // A repaired parser must revisit an old refusal instead of waiting out its
    // retry delay. Already acknowledged products still come from the catalog.
    const fingerprint = await sha(new TextEncoder().encode(JSON.stringify(['primary_identity_v2', receipt.vendor_name, line.part_number, line.description])));
    const previous = queue.data.product_result?.items?.[line.id];
    const card = await admin.rpc('receipt_item_product_card', { p_item: line.id });
    if (card.error) throw new Error('catalog_reader_unavailable');
    if (card.data) { outcomes[line.id] = { fingerprint, status: 'matched', catalog_part_id: card.data.catalog_part_id }; continue; }
    complete = false;
    if (previous?.fingerprint === fingerprint && Date.parse(previous.retry_at) > Date.now()) {
      outcomes[line.id] = previous; nextRetry = Math.min(nextRetry, Math.ceil((Date.parse(previous.retry_at) - Date.now()) / 1000)); continue;
    }
    if (processed >= 2) { outcomes[line.id] = { fingerprint, status: 'queued' }; nextRetry = Math.min(nextRetry, 60); continue; }
    const lineCode = supplierKey(receipt.vendor_name) === 'oreilly' ? receiptLineCode(line.description) : null;
    const missingLineCode = supplierKey(receipt.vendor_name) === 'oreilly' && !lineCode;
    const candidates = missingLineCode ? [] : supplierCandidates(receipt.vendor_name, line.part_number);
    let reason = missingLineCode ? 'receipt_line_code_missing' : 'supplier_not_integrated'; let matched = false;
    if (candidates.length) processed++;
    for (const candidate of candidates) {
      if (blockedHosts.has(new URL(candidate.url).hostname)) { reason = 'supplier_capture_unavailable'; continue; }
      try {
        let page = await effects.capturePage(admin, candidate.url);
        if (candidate.kind === 'search') {
          const links = productLinks(page.html, candidate.url, line.part_number, lineCode);
          if (links.length !== 1) { reason = links.length ? 'ambiguous_product_links' : 'exact_product_link_missing'; continue; }
          page = await effects.capturePage(admin, links[0]);
        }
        const product = parseProductPage(page.html, page.source.listing_url, line.part_number);
        if (product.status !== 'exact_sku_page' || !product.image_url) { reason = product.status; continue; }
        if (lineCode && product.line_code !== lineCode) { reason = 'product_line_code_mismatch'; continue; }
        const image = await effects.retainImage(admin, product.image_url);
        const saved = await admin.rpc('record_receipt_catalog_product', { p_supplier: supplierKey(receipt.vendor_name), p_number: normalizePart(line.part_number),
          p_capture: { ...image, name: product.product_name, printed_sku: product.printed_sku, product_line_code: product.line_code, manufacturer: product.manufacturer,
            description: product.description, price: product.price, currency: product.currency, source_role: candidate.role,
            match_basis: product.match_basis, image_source_url: product.image_url, parser: 'receipt_product_page_v1',
            page_url: page.source.listing_url, snapshot_id: page.source.id, page_sha256: page.source.html_sha256 } });
        if (saved.error || !saved.data) throw new Error('catalog_admission_failed');
        outcomes[line.id] = { fingerprint, status: 'matched', catalog_part_id: saved.data }; matched = true; break;
      } catch (error) {
        reason = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'product_capture_failed';
        if (['supplier_budget_deferred','supplier_capture_unavailable'].includes(reason)) blockedHosts.add(new URL(candidate.url).hostname);
      }
    }
    if (!matched) {
      const retry = reason === 'supplier_not_integrated' ? 604800 : reason.includes('unavailable') || reason.includes('deferred') ? 3600 : 86400;
      outcomes[line.id] = { fingerprint, status: reason, retry_at: new Date(Date.now() + retry * 1000).toISOString() };
      nextRetry = Math.min(nextRetry, retry);
    }
  }
  // Completion means every current eligible line has a catalog acknowledgement.
  complete = Object.values(outcomes).every(item => item.status === 'matched');
  return reply(complete, complete ? 0 : nextRetry);
}
