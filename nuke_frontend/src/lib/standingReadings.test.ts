import { describe, expect, it } from 'vitest';
import { AUTOMATIC_READING_TIER, STANDING_READING_TIER_FILTER, standingReadings } from './standingReadings';

function recorder() {
  const calls: Array<[string, ...unknown[]]> = [];
  const q = {
    not(c: string, o: string, v: unknown) { calls.push(['not', c, o, v]); return q; },
    or(f: string) { calls.push(['or', f]); return q; },
  };
  return { q, calls };
}

describe('standingReadings', () => {
  it('excludes superseded rows and automatic-tier rows, keeps rows with no tier', () => {
    const { q, calls } = recorder();
    expect(standingReadings(q)).toBe(q);
    expect(calls).toEqual([
      ['not', 'is_superseded', 'is', true],
      ['or', 'agent_tier.is.null,agent_tier.neq.subscription automatic'],
    ]);
  });

  it('uses the automatic tier literal the photo reader writes', () => {
    expect(AUTOMATIC_READING_TIER).toBe('subscription automatic');
    expect(STANDING_READING_TIER_FILTER).toContain('agent_tier.is.null');
  });
});
