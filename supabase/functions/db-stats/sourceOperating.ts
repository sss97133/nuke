// Bounded operational inventories. These owners overlap and have different
// grains; their row counts must never be added into a global source census.
export const SOURCE_OPERATING_LIMIT = 1000;
export const SOURCE_OPERATING_OWNERS = ['source_registry', 'scrape_sources', 'listing_feeds', 'forum_sources'] as const;
export type SourceOperatingOwner = typeof SOURCE_OPERATING_OWNERS[number];
export const SOURCE_OPERATING_UNITS = {
  source_registry: 'platforms', scrape_sources: 'scrape targets', listing_feeds: 'feed targets', forum_sources: 'forums',
} as const;

const inventory = (select: string) => `SELECT statement_timestamp()::text AS measured_at,
  coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) AS rows FROM (${select} LIMIT ${SOURCE_OPERATING_LIMIT + 1}) s`;

// Allowlisted metadata only: no URLs, contacts, configurations or raw errors.
// last_polled_at is stamped BEFORE work by poll-listing-feeds. None of these
// markers establishes completed capture, landed testimony or public usefulness.
export const SOURCE_OPERATING_QUERIES = {
  source_registry: inventory(`SELECT id::text, display_name AS label,
    status IN ('active', 'monitoring') AS enabled,
    monitoring_frequency_hours * 60 AS cadence_minutes,
    last_successful_at AS last_activity_at, 'last_successful_at'::text AS activity_basis,
    NULL::boolean AS has_error FROM public.source_registry ORDER BY id`),
  scrape_sources: inventory(`SELECT id::text, name AS label, is_active AS enabled,
    scrape_frequency_hours * 60 AS cadence_minutes,
    last_scraped_at AS last_activity_at, 'last_scraped_at'::text AS activity_basis,
    NULL::boolean AS has_error FROM public.scrape_sources ORDER BY id`),
  listing_feeds: inventory(`SELECT id::text, display_name AS label, enabled,
    poll_interval_minutes AS cadence_minutes,
    last_polled_at AS last_activity_at, 'last_polled_at'::text AS activity_basis,
    (nullif(last_error, '') IS NOT NULL OR coalesce(error_count, 0) > 0) AS has_error
    FROM public.listing_feeds ORDER BY id`),
  forum_sources: inventory(`SELECT id::text, name AS label, NULL::boolean AS enabled,
    NULL::numeric AS cadence_minutes,
    last_crawled_at AS last_activity_at, 'last_crawled_at'::text AS activity_basis,
    (nullif(last_error, '') IS NOT NULL OR coalesce(consecutive_failures, 0) > 0) AS has_error
    FROM public.forum_sources ORDER BY id`),
} as const;

export type SourceOperatingState = 'inactive' | 'configuration_unknown' | 'cadence_missing'
  | 'never_reported' | 'overdue' | 'recent_activity' | 'invalid_clock';
export interface SourceOperatingRow {
  id: string;
  label: string;
  enabled: boolean | null;
  cadence_minutes: number | null;
  last_activity_at: string | null;
  activity_basis: string;
  has_error: boolean | null;
}

export function sourceOperatingState(row: SourceOperatingRow, measuredAt: string): SourceOperatingState {
  if (row.enabled === false) return 'inactive';
  if (row.enabled === null) return 'configuration_unknown';
  const now = Date.parse(measuredAt);
  const activity = row.last_activity_at === null ? null : Date.parse(row.last_activity_at);
  if (!Number.isFinite(now) || activity !== null && (!Number.isFinite(activity) || activity > now)) return 'invalid_clock';
  if (row.cadence_minutes === null || !Number.isFinite(row.cadence_minutes) || row.cadence_minutes <= 0) return 'cadence_missing';
  if (activity === null) return 'never_reported';
  return now - activity >= row.cadence_minutes * 60_000 ? 'overdue' : 'recent_activity';
}

export function shapeSourceInventory(owner: SourceOperatingOwner, reading: {
  status: string; measured_at: string | null; rows: Record<string, unknown>[];
}) {
  const unavailable = { owner, unit: SOURCE_OPERATING_UNITS[owner], status: 'unavailable',
    measured_at: null, complete: false, row_limit: SOURCE_OPERATING_LIMIT, rows: [] };
  if (reading.status !== 'measured' || !reading.measured_at || !Number.isFinite(Date.parse(reading.measured_at))) return unavailable;
  const rows = reading.rows.slice(0, SOURCE_OPERATING_LIMIT);
  if (rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) return unavailable;
  const basis = { source_registry: 'last_successful_at', scrape_sources: 'last_scraped_at',
    listing_feeds: 'last_polled_at', forum_sources: 'last_crawled_at' }[owner];
  if (new Set(rows.map(r => r.id)).size !== rows.length || rows.some(r =>
    typeof r.id !== 'string' || !r.id || typeof r.label !== 'string'
    || ![true, false, null].includes(r.enabled as boolean | null)
    || !(r.cadence_minutes === null || typeof r.cadence_minutes === 'number' && Number.isFinite(r.cadence_minutes))
    || !(r.last_activity_at === null || typeof r.last_activity_at === 'string' && Number.isFinite(Date.parse(r.last_activity_at)))
    || r.activity_basis !== basis || ![true, false, null].includes(r.has_error as boolean | null))) return unavailable;
  return { owner, unit: SOURCE_OPERATING_UNITS[owner], status: 'measured', measured_at: reading.measured_at,
    complete: reading.rows.length <= SOURCE_OPERATING_LIMIT, row_limit: SOURCE_OPERATING_LIMIT,
    rows: rows.map(r => {
      // Project again so a future SQL change cannot accidentally expose a body.
      const row: SourceOperatingRow = { id: r.id as string, label: r.label as string, enabled: r.enabled as boolean | null,
        cadence_minutes: r.cadence_minutes as number | null, last_activity_at: r.last_activity_at as string | null,
        activity_basis: r.activity_basis as string, has_error: r.has_error as boolean | null };
      return { ...row, state: sourceOperatingState(row, reading.measured_at!) };
    }) };
}
