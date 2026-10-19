// The job header the edge middleware already read (middleware.ts → lib/discoveryFace.ts jobHeaderPayload), embedded
// in the HTML as public fields only, so a direct load paints the job's header before the page's own read returns.
import { JOB_HEADER_ID } from '../../lib/discoveryFace';

export type JobHeader = {
  work_order_id: string;
  display_title: string | null;
  vehicle_label: { text?: string | null } | null;
  vehicle_id: string | null;
  request_source_label: string | null;
  stages: Record<string, string>;
};

export function readJobHeader(workOrderId: string): JobHeader | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(JOB_HEADER_ID);
  if (!el?.textContent) return null;
  try {
    const o = JSON.parse(el.textContent) as JobHeader;
    return o && o.work_order_id === workOrderId ? o : null;
  } catch {
    return null;
  }
}
