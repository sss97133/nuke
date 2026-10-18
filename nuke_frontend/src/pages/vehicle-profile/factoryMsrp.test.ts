import { describe, it, expect } from 'vitest';
import { factoryMsrp } from './factoryMsrp';

describe('factoryMsrp', () => {
  it('hides a resale median written as an MSRP, shows every other source', () => {
    // 1979 Lotus Elite d164e564: vehicles.msrp 61900, msrp_source 'ai_estimated' (live, 2026-09-27)
    expect(factoryMsrp({ msrp: 61900, msrp_source: 'ai_estimated' })).toBeNull();
    expect(factoryMsrp({ msrp: 46468, msrp_source: 'oem' })).toBe(46468);
    expect(factoryMsrp({ msrp: 30000, msrp_source: 'listing_parsed' })).toBe(30000);
    expect(factoryMsrp({ msrp: 30000, msrp_source: 'user' })).toBe(30000);
    expect(factoryMsrp({ msrp: 30000, msrp_source: null })).toBe(30000);
    expect(factoryMsrp({ msrp: 30000 })).toBe(30000);
    expect(factoryMsrp({ msrp: null, msrp_source: 'oem' })).toBeNull();
    expect(factoryMsrp(null)).toBeNull();
  });
});
