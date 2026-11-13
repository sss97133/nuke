import { htmlToText } from '../../../../supabase/functions/_shared/htmlToText';

/** Optional source-history contract from the existing get_vehicle_specs reader. */
export interface ListingDescription {
  source_observation_id: string;
  source_url: string;
  text: string;
  recorded_observed_at: string | null;
  source_captured_at: string | null;
  ingested_at: string | null;
  extraction_method: string | null;
  confidence: number | null;
}

export function listingDescriptionsFromSpecs(specs: unknown): ListingDescription[] {
  if (!Array.isArray(specs)) return [];
  const sources = specs.find(row => row?.field === 'description')?.source_descriptions;
  if (!Array.isArray(sources)) return [];
  return sources.slice(0, 5).filter(entry => {
    if (entry?.status !== 'preserved' || entry.reader_truncated !== false ||
        entry.source_completeness !== 'unknown' || entry.source_event_time_status !== 'unknown' ||
        typeof entry.text !== 'string' || entry.text.length > 32_000 || entry.text.trim().length < 100 ||
        typeof entry.source_observation_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.source_observation_id)) return false;
    try { return ['http:', 'https:'].includes(new URL(entry.source_url).protocol); } catch { return false; }
  });
}

/** Presentation only: preserve plain testimony verbatim and keep original HTML in its observation. */
export function listingDescriptionText(text: string): string {
  if (!/<\/?(?:p|div|ul|ol|li|br|b|strong|em|h[1-6])(?:\s[^>]*)?\/?>/i.test(text)) return text;
  return htmlToText(text.replace(/<(?:ul|ol)\b[^>]*>/gi, '\n'));
}
