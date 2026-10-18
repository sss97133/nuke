// map/ownerLayer.ts — which open calls are the owner's to make, the one rule the MAP tab's NEEDS YOU strip uses and the
// later reclassify pass reuses.
//
// Owner 2026-09-29: "engineering calls are made by the system". What stays his is the "Skylar decides" column of his
// working rules (~/.claude/CLAUDE.md): money (spending, purchases), hands (what only he can do, see or measure on the
// truck), legal, and credentials. Architecture, placement, part choice and policy calls are the system's to make and
// record; they stay in the owner's calls table, never in NEEDS YOU.
//
// The rows' decision_kind still carries the engineering kinds (architecture, part_choice, placement, policy), so today
// this keeps none of them; it keeps a call once the reclassify pass writes one of these kinds on it.

import type { MapCall } from './useWiringMap';

export const OWNER_KINDS = ['money', 'hands', 'legal', 'credentials'] as const;

export function needsOwner(call: Pick<MapCall, 'kind' | 'decided'>): boolean {
  return !call.decided && (OWNER_KINDS as readonly string[]).includes((call.kind ?? '').toLowerCase());
}
