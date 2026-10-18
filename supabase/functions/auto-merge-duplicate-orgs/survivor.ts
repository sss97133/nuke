// Which of two duplicate organizations survives a merge. The OLDER one (smaller created_at) survives, so a freshly
// created duplicate can never absorb an older, real organization. A missing created_at sorts as infinitely new
// (never the survivor over a dated row); a tie, or both missing, breaks by id for determinism. Returned value is the
// surviving (target) id; the other is the source that gets hidden and moved.
export interface MergeCandidate {
  id: string;
  created_at?: string | null;
}

export function pickSurvivorId(a: MergeCandidate, b: MergeCandidate): string {
  const ta = a.created_at ? new Date(a.created_at).getTime() : Number.POSITIVE_INFINITY;
  const tb = b.created_at ? new Date(b.created_at).getTime() : Number.POSITIVE_INFINITY;
  // A finite (dated) timestamp is always older than a missing one (infinity), so the dated row wins; two dated rows
  // compare by age; equal or both-missing breaks by id.
  if (ta !== tb) return ta < tb ? a.id : b.id;
  return a.id < b.id ? a.id : b.id;
}
