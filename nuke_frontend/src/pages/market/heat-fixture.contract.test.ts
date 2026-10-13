// @vitest-environment jsdom
// The heatOf contract: one fixture, two clients. The phone runs the same JSON through LiveAuction.heat
// (apps/nuke-capture-ios UnitTests/DecodeTests.swift, test resource at this path). The fixture is
// market_pulse_live as read at 2026-10-13T23:00:09Z, its curve, the thresholds, every live lot and the
// verdict each should get. Written by the iOS lane (skylar-74) from that payload; the web's heatOf must
// reproduce it, and the thresholds it states must be the ones the page exports.
import { describe, it, expect } from 'vitest';
import { heatOf, HEAT_THRESHOLDS } from './MarketPulse';
import type { BidCurve } from './useMarketPulse';
import fixture from './__fixtures__/heat-fixture-20261013T2300Z.json';

describe('heatOf contract (fixture 2026-10-13T23:00Z, 1,148 lots)', () => {
  it('reproduces every state and ratio the fixture carries', () => {
    const curve = fixture.curve as BidCurve;
    const now = fixture.now_ms as number;
    let checked = 0;
    for (const [i, lot] of (fixture.lots as any[]).entries()) {
      const exp = (fixture.expected as any[])[i];
      const a = { ...lot, endsAt: Date.parse(lot.endsAt) } as any;
      const h = heatOf(a, curve, now);
      if (exp.state === null) { expect(h, lot.id).toBeNull(); continue; }
      expect(h, lot.id).not.toBeNull();
      expect(h!.state, lot.id).toBe(exp.state);
      expect(Math.abs(h!.ratio - exp.ratio), lot.id).toBeLessThan(1e-6);
      checked++;
    }
    expect(checked).toBe((fixture.lots as any[]).length - (fixture.counts as any).none);
    expect(checked).toBeGreaterThan(0);
  });
  it('states its thresholds once, and they are the ones the page exports', () => {
    expect(fixture.thresholds).toEqual({ hot: 1.25, cold: 0.8, max_hours: 120 });
    expect(HEAT_THRESHOLDS).toEqual({ hot: fixture.thresholds.hot, cold: fixture.thresholds.cold, maxHours: fixture.thresholds.max_hours });
  });
});
