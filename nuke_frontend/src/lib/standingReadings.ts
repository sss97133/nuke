// Which vehicle_observations rows a reading list shows.
//
// The automatic photo reader writes provisional readings (agent_tier 'subscription automatic').
// They are not reviewed readings, and a reviewed reading replaces them (is_superseded). A list of
// readings therefore leaves out superseded rows and automatic-tier rows, and keeps rows with no tier.
// Same tier literal as scripts/lib/byok-stage-schema.mjs (AUTOMATIC_READING_TIER).

export const AUTOMATIC_READING_TIER = 'subscription automatic';

// PostgREST `or` filter: no tier recorded, or a tier other than the automatic one.
export const STANDING_READING_TIER_FILTER = `agent_tier.is.null,agent_tier.neq.${AUTOMATIC_READING_TIER}`;

interface ObservationFilterBuilder<Q> {
  not(column: string, operator: string, value: unknown): Q;
  or(filters: string): Q;
}

/** Narrow a vehicle_observations query to standing (not superseded, not automatic-tier) rows. */
export function standingReadings<Q extends ObservationFilterBuilder<Q>>(query: Q): Q {
  return query.not('is_superseded', 'is', true).or(STANDING_READING_TIER_FILTER);
}
