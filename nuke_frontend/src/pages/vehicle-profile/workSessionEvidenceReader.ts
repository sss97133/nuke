import { supabase } from '../../lib/supabase';

export interface WorkOperation {
  task: string;
  component: string | null;
  before: string | null;
  after: string | null;
  signal: string | null;
  valueStatus: string | null;
  imageIds: string[];
}
export interface WorkSessionContext {
  model: string | null;
  analyzedAt: string | null;
  operations: WorkOperation[];
  photos: { id: string; image_url: string }[];
  photosUnavailable: boolean;
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Existing analysis is attributed context, never an installation or value decision.
 * Read one current session under caller RLS; expose no financial/owner-answer metadata.
 * A cited frame must still belong to this vehicle AND session and pass gallery eligibility.
 */
export async function readWorkSessionContext(vehicleId: string, sessionId: string, date: string): Promise<WorkSessionContext> {
  const { data, error } = await supabase.from('work_sessions')
    .select('id,vehicle_id,session_date,work_items:metadata->synthesis->work_items,synthesis_model:metadata->synthesis->>synthesis_model,synthesized_at:metadata->synthesis->>synthesized_at')
    .eq('id', sessionId).eq('vehicle_id', vehicleId).eq('session_date', date).maybeSingle();
  if (error || !data || data.id !== sessionId || data.vehicle_id !== vehicleId || data.session_date !== date) {
    throw new Error('Work context unavailable.');
  }
  const synthesis = data;
  const operations: WorkOperation[] = Array.isArray(synthesis?.work_items) ? synthesis.work_items.flatMap(value => {
    const item = record(value);
    if (!item || !text(item.task)) return [];
    const completeness = record(item.completeness);
    return [{ task: text(item.task)!, component: text(item.component), before: text(completeness?.before),
      after: text(completeness?.after), signal: text(item.labor_signal), valueStatus: text(item.value_status),
      imageIds: Array.isArray(item.evidence_frame_ids) ? [...new Set<string>(item.evidence_frame_ids.filter((id: unknown) => typeof id === 'string' && uuid.test(id)))] : [] }];
  }) : [];
  const imageIds = [...new Set(operations.flatMap(op => op.imageIds))];
  const photos: WorkSessionContext['photos'] = [];
  let photosUnavailable = false;
  // Bound URL size without silently dropping the rest of a session's cited evidence.
  for (let offset = 0; offset < imageIds.length; offset += 50) {
    const result = await supabase.from('vehicle_images').select('id,image_url,vehicle_id,work_session_id')
      .eq('vehicle_id', vehicleId).eq('work_session_id', sessionId)
      .eq('vehicle_image_gallery_eligible', true).in('id', imageIds.slice(offset, offset + 50));
    if (result.error || !Array.isArray(result.data)) { photosUnavailable = true; break; }
    photos.push(...result.data.filter(p => p.vehicle_id === vehicleId && p.work_session_id === sessionId && imageIds.includes(p.id) && text(p.image_url)));
  }
  return { model: text(synthesis?.synthesis_model), analyzedAt: text(synthesis?.synthesized_at), operations, photos, photosUnavailable };
}
