import { supabase } from '../lib/supabase';

export type ValidationRetryMark = { status: 'failed' | 'pending_retry'; error: string; retry_at: string };

/**
 * Records a validation retry on a vehicle_images row by adding `validation` to its current
 * ai_scan_metadata. The document is re-read first: spreading the insert-time copy would drop every
 * key written after insert (flag_duplicate_image's skipped / duplicate_of, a classification), and once
 * end users may not change served scan keys that write is refused outright.
 * Returns the update's error, if any; the image is already saved, so callers only log it.
 */
export async function markImageValidationRetry(
  imageId: string,
  insertTimeMetadata: Record<string, unknown> | null | undefined,
  validation: ValidationRetryMark,
) {
  // Reads the base column, which the uploader may select today. When the base-column revoke after #3935 lands,
  // switch this read to supabase.rpc('vehicle_image_scan_metadata', { p_image_id }).
  const { data: current } = await supabase
    .from('vehicle_images')
    .select('ai_scan_metadata')
    .eq('id', imageId)
    .single();
  const base = (current?.ai_scan_metadata && typeof current.ai_scan_metadata === 'object')
    ? current.ai_scan_metadata as Record<string, unknown>
    : (insertTimeMetadata ?? {});
  const { error } = await supabase
    .from('vehicle_images')
    .update({ ai_scan_metadata: { ...base, validation } })
    .eq('id', imageId);
  return error;
}
