/** Bounded public-image qualification. No database client, writes or downstream routes. */
import { classifyImage, CANDIDATE_CLASSIFIER_MODEL, CLASSIFIER_BUDGET, CLASSIFIER_PRICES, type ClassificationResult } from '../../supabase/functions/photo-pipeline-orchestrator/classifier.ts';
export const ASSAY_VEHICLE = '2e61fa34-c5b4-4709-9636-4823546a5bc4';
export const ASSAY_EVENT = '561c96be-3855-41cf-ae08-bf31ba3fcb4d';
export const ASSAY_POSITIONS = [0,21,42,63,84,105,126,147,168,189,209,230,251,272,293,314,335,356,377,398];
const LISTING = 'https://bringatrailer.com/listing/2006-pontiac-solstice-92';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AssayImage { image_id: string; vehicle_id: string; auction_event_id: string; position: number; image_url: string; source_url: string; listing_url: string; source: string; is_document: boolean; is_sensitive: boolean; is_duplicate: boolean; is_superseded: boolean; vision_gate_status: string; }
export function validateManifest(value: unknown): AssayImage[] {
  const images = (value as { images?: AssayImage[] })?.images;
  if (!Array.isArray(images) || images.length !== 20 || new Set(images.map(i => i?.image_id)).size !== 20) throw new Error('manifest_invalid');
  for (const [index, image] of images.entries()) {
    let url: URL; try { url = new URL(image.image_url); } catch { throw new Error('manifest_invalid'); }
    if (!UUID.test(image.image_id) || image.vehicle_id !== ASSAY_VEHICLE || image.auction_event_id !== ASSAY_EVENT ||
      image.position !== ASSAY_POSITIONS[index] || image.source !== 'bat_import' || image.listing_url.replace(/\/$/, '') !== LISTING ||
      [image.is_document,image.is_sensitive,image.is_duplicate,image.is_superseded].some(flag => flag !== false) ||
      !['pending','approved'].includes(image.vision_gate_status) || url.protocol !== 'https:' || url.hostname !== 'bringatrailer.com' ||
      !url.pathname.startsWith('/wp-content/uploads/') || url.username || url.password || url.search || url.hash) throw new Error('manifest_invalid');
  }
  return structuredClone(images);
}
const MAX_RESERVED_PER_IMAGE = (CLASSIFIER_BUDGET.input_tokens * CLASSIFIER_PRICES[CANDIDATE_CLASSIFIER_MODEL].input_per_million +
  CLASSIFIER_BUDGET.output_tokens * CLASSIFIER_PRICES[CANDIDATE_CLASSIFIER_MODEL].output_per_million) / 1_000_000;
export async function runPhotoClassifierAssay(manifest: unknown, key: string, dependencies: {
  classify?: typeof classifyImage; fetch?: typeof fetch; now?: () => number;
  save?: (receipt: unknown) => Promise<void>;
} = {}) {
  const images = validateManifest(manifest);
  if (!key?.trim()) throw new Error('credential_missing');
  const now = dependencies.now ?? Date.now;
  const started = now();
  const receipt = { version: 'solstice_photo_classifier_assay_v1', started_at: new Date(started).toISOString(),
    model: CANDIDATE_CLASSIFIER_MODEL, classifier_only: true, database_writes: 0, downstream_calls: 0,
    prices: CLASSIFIER_PRICES[CANDIDATE_CLASSIFIER_MODEL], pricing_checked_at: '2026-10-03',
    pricing_url: 'https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite',
    budget: { images:20, generation_ceiling_usd:0.04, hard_budget_usd:1, run_ms:1200000, ...CLASSIFIER_BUDGET },
    manifest_sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest)))))
      .map(value => value.toString(16).padStart(2,'0')).join(''),
    status:'running', stop_reason:null as string | null, calls:0, passed:0, failed:0,
    generation_attempts:0, reserved_generation_cost_usd:0, known_estimated_cost_usd:0, unresolved_usage_attempts:0,
    records:[] as Array<{ image:AssayImage; classification:ClassificationResult | null; status:string }>,
    unattempted_image_ids:images.map(image => image.image_id), finished_at:null as string | null };
  let transportFailures = 0;
  for (const image of images) {
    if (now() - started >= receipt.budget.run_ms || receipt.reserved_generation_cost_usd + MAX_RESERVED_PER_IMAGE > receipt.budget.generation_ceiling_usd) {
      receipt.stop_reason = 'assay_budget_reached'; break;
    }
    // Reserve before provider work and save before the call. A killed process
    // leaves this source explicitly unresolved, never silently marked complete.
    receipt.reserved_generation_cost_usd += MAX_RESERVED_PER_IMAGE;
    const record = { image, classification:null as ClassificationResult | null, status:'attempting' };
    receipt.records.push(record); receipt.calls++;
    await dependencies.save?.(receipt);
    const result = await (dependencies.classify ?? classifyImage)(image.image_url, key, dependencies.fetch,
      { model:CANDIDATE_CLASSIFIER_MODEL });
    record.classification = result; record.status = result.classifier_ok === true ? 'classified' : 'failed';
    receipt.unattempted_image_ids.shift();
    const r = result.classifier_receipt;
    receipt.generation_attempts += r?.attempts ?? 0;
    if (typeof r?.estimated_cost_usd === 'number') receipt.known_estimated_cost_usd += r.estimated_cost_usd;
    else if ((r?.attempts ?? 0) > 0) receipt.unresolved_usage_attempts++;
    result.classifier_ok === true ? receipt.passed++ : receipt.failed++;
    const phase = r?.failure_phase;
    const providerFailure = phase === 'token_count' || phase === 'classification';
    if (providerFailure && [400,401,403,404,429].includes(r?.http_status ?? 0)) receipt.stop_reason = 'provider_rejected_cohort';
    if (providerFailure && ['classifier_timeout','classifier_request_error'].includes(r?.error_class ?? '')) transportFailures++;
    else transportFailures = 0;
    if (transportFailures >= 2) receipt.stop_reason = 'repeated_provider_transport_failure';
    if (r?.error_class === 'classifier_usage_budget_exceeded' || receipt.known_estimated_cost_usd > receipt.budget.generation_ceiling_usd) receipt.stop_reason = 'provider_usage_budget_exceeded';
    await dependencies.save?.(receipt);
    if (receipt.stop_reason) break;
  }
  receipt.status = receipt.stop_reason ? 'stopped' : receipt.failed ? 'completed_with_failures' : 'completed';
  receipt.finished_at = new Date(now()).toISOString();
  await dependencies.save?.(receipt);
  return receipt;
}
if (import.meta.main) {
  try {
    const [manifestPath, outputPath] = Deno.args;
    if (!manifestPath || !outputPath || !outputPath.startsWith('/Users/skylar/nuke-logs/')) throw new Error('paths_invalid');
    const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
    const save = async (receipt: unknown) => {
      const temporary = `${outputPath}.tmp`;
      await Deno.writeTextFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode:0o600 });
      await Deno.chmod(temporary,0o600); await Deno.rename(temporary,outputPath);
    };
    const result = await runPhotoClassifierAssay(manifest,Deno.env.get('GEMINI_API_KEY') ?? '',{save});
    console.log(JSON.stringify({receipt:outputPath,status:result.status,passed:result.passed,failed:result.failed,
      generation_attempts:result.generation_attempts,known_estimated_cost_usd:result.known_estimated_cost_usd,
      unresolved_usage_attempts:result.unresolved_usage_attempts,stop_reason:result.stop_reason,unattempted:result.unattempted_image_ids.length}));
    if (result.status !== 'completed') Deno.exitCode=1;
  } catch { console.log(JSON.stringify({status:'assay_failed',error_class:'assay_initialization_or_receipt_error'})); Deno.exitCode=1; }
}
