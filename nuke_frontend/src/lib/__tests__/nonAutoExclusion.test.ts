import { describe, it, expect } from 'vitest';
import {
  AUTO_VEHICLE_TYPES,
  NON_AUTO_MAKES,
  NON_AUTO_MAKES_CSV,
  applyNonAutoFilters,
  isAutoVehicle,
} from '../nonAutoExclusion';

describe('nonAutoExclusion constants', () => {
  it('AUTO_VEHICLE_TYPES contains exactly 5 types', () => {
    expect(AUTO_VEHICLE_TYPES).toEqual(['CAR', 'TRUCK', 'SUV', 'VAN', 'MINIVAN']);
  });

  it('NON_AUTO_MAKES has no exact-string duplicates', () => {
    // Case-insensitive duplicates are intentional (PostgREST is case-sensitive)
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const m of NON_AUTO_MAKES) {
      if (seen.has(m)) dupes.push(m);
      seen.add(m);
    }
    expect(dupes).toEqual([]);
  });

  it('NON_AUTO_MAKES has both UPPER and Mixed-case variants for key makes', () => {
    const entries = new Set(NON_AUTO_MAKES as readonly string[]);
    // Spot-check a few that must have both forms
    expect(entries.has('HARLEY-DAVIDSON')).toBe(true);
    expect(entries.has('Harley-Davidson')).toBe(true);
    expect(entries.has('WINNEBAGO')).toBe(true);
    expect(entries.has('Winnebago')).toBe(true);
    expect(entries.has('DUCATI')).toBe(true);
    expect(entries.has('Ducati')).toBe(true);
  });

  it('NON_AUTO_MAKES does NOT contain dual-use makes', () => {
    const dualUse = ['YAMAHA', 'KAWASAKI', 'SUZUKI', 'TRIUMPH', 'INDIAN'];
    const blocked = NON_AUTO_MAKES.map(m => m.toUpperCase());
    for (const make of dualUse) {
      expect(blocked).not.toContain(make);
    }
  });

  it('NON_AUTO_MAKES_CSV is comma-joined NON_AUTO_MAKES', () => {
    expect(NON_AUTO_MAKES_CSV).toBe(NON_AUTO_MAKES.join(','));
  });

  it('NON_AUTO_MAKES contains known motorcycle-only makes', () => {
    const upper = NON_AUTO_MAKES.map(m => m.toUpperCase());
    for (const make of ['HARLEY-DAVIDSON', 'DUCATI', 'KTM', 'HUSQVARNA', 'APRILIA']) {
      expect(upper).toContain(make);
    }
  });

  it('NON_AUTO_MAKES contains known non-auto categories', () => {
    const upper = NON_AUTO_MAKES.map(m => m.toUpperCase());
    // Marine
    expect(upper).toContain('SEA-DOO');
    expect(upper).toContain('SEA RAY');
    // RV
    expect(upper).toContain('WINNEBAGO');
    expect(upper).toContain('AIRSTREAM');
    // Farm
    expect(upper).toContain('JOHN DEERE');
    expect(upper).toContain('CATERPILLAR');
    // Heavy duty
    expect(upper).toContain('FREIGHTLINER');
    expect(upper).toContain('PETERBILT');
    // Aircraft
    expect(upper).toContain('CESSNA');
    // Trailers
    expect(upper).toContain('FEATHERLITE');
    // Golf carts
    expect(upper).toContain('EZGO');
    // Junk
    expect(upper).toContain('ILLUMINATED');
  });

  it('NON_AUTO_MAKES includes variant spellings', () => {
    const upper = NON_AUTO_MAKES.map(m => m.toUpperCase());
    expect(upper).toContain('HARLEY');
    expect(upper).toContain('HARLEYDAVIDSON');
    expect(upper).toContain('SEADOO');
    expect(upper).toContain('SEARAY');
    expect(upper).toContain('SKIDOO');
  });
});

describe('isAutoVehicle', () => {
  describe('should return true for automobiles', () => {
    it.each([
      [{ canonical_vehicle_type: 'CAR', make: 'Ford' }, 'standard car'],
      [{ canonical_vehicle_type: 'TRUCK', make: 'Ford' }, 'truck'],
      [{ canonical_vehicle_type: 'SUV', make: 'Chevrolet' }, 'SUV'],
      [{ canonical_vehicle_type: 'VAN', make: 'Dodge' }, 'van'],
      [{ canonical_vehicle_type: 'MINIVAN', make: 'Honda' }, 'minivan'],
      [{ canonical_vehicle_type: null, make: 'Ford' }, 'unclassified car make'],
      [{ canonical_vehicle_type: null, make: null }, 'totally unknown'],
      [{ canonical_vehicle_type: null, make: '' }, 'empty make'],
      [{ canonical_vehicle_type: 'CAR', make: 'Harley' }, 'type priority over make blocklist'],
      [{ canonical_vehicle_type: null, make: 'Triumph' }, 'dual-use: Triumph'],
      [{ canonical_vehicle_type: null, make: 'Yamaha' }, 'dual-use: Yamaha'],
      [{ canonical_vehicle_type: null, make: 'Kawasaki' }, 'dual-use: Kawasaki'],
      [{ canonical_vehicle_type: null, make: 'Indian' }, 'dual-use: Indian'],
      [{ canonical_vehicle_type: null, make: 'Suzuki' }, 'dual-use: Suzuki'],
      [{ canonical_vehicle_type: 'car', make: 'Ford' }, 'lowercase type normalizes'],
    ] as const)('%s — %s', (vehicle) => {
      expect(isAutoVehicle(vehicle)).toBe(true);
    });
  });

  describe('should return false for non-automobiles', () => {
    it.each([
      [{ canonical_vehicle_type: 'MOTORCYCLE', make: 'Harley-Davidson' }, 'classified motorcycle'],
      [{ canonical_vehicle_type: 'BOAT', make: 'Sea Ray' }, 'classified boat'],
      [{ canonical_vehicle_type: 'RV', make: 'Winnebago' }, 'classified RV'],
      [{ canonical_vehicle_type: 'HEAVY_EQUIPMENT', make: 'John Deere' }, 'farm equipment'],
      [{ canonical_vehicle_type: 'OTHER', make: 'Cessna' }, 'aircraft/other'],
      [{ canonical_vehicle_type: 'TRAILER', make: 'Featherlite' }, 'trailer'],
      [{ canonical_vehicle_type: 'ATV', make: 'Polaris' }, 'ATV'],
      [{ canonical_vehicle_type: 'BUS', make: 'Freightliner' }, 'bus/heavy truck'],
      [{ canonical_vehicle_type: null, make: 'Harley-Davidson' }, 'unclassified blocked make'],
      [{ canonical_vehicle_type: null, make: 'HARLEY-DAVIDSON' }, 'uppercase blocked make'],
      [{ canonical_vehicle_type: null, make: 'harley-davidson' }, 'lowercase blocked make'],
      [{ canonical_vehicle_type: null, make: 'Harley' }, 'short-form blocked make'],
      [{ canonical_vehicle_type: null, make: 'Ducati' }, 'unclassified motorcycle make'],
      [{ canonical_vehicle_type: null, make: 'Winnebago' }, 'unclassified RV make'],
      [{ canonical_vehicle_type: null, make: 'WINNEBAGO' }, 'uppercase RV make'],
      [{ canonical_vehicle_type: null, make: 'Sea-Doo' }, 'marine make'],
      [{ canonical_vehicle_type: null, make: 'John Deere' }, 'farm make'],
      [{ canonical_vehicle_type: null, make: 'ILLUMINATED' }, 'junk/misparsed'],
      [{ canonical_vehicle_type: null, make: 'Cessna' }, 'aircraft make'],
      [{ canonical_vehicle_type: null, make: 'EZGO' }, 'golf cart make'],
    ] as const)('%s — %s', (vehicle) => {
      expect(isAutoVehicle(vehicle)).toBe(false);
    });
  });

  it('non-auto type overrides a good make', () => {
    expect(isAutoVehicle({ canonical_vehicle_type: 'BOAT', make: 'Ford' })).toBe(false);
    expect(isAutoVehicle({ canonical_vehicle_type: 'MOTORCYCLE', make: 'Porsche' })).toBe(false);
  });
});

describe('applyNonAutoFilters', () => {
  it('calls .or() with vehicle type whitelist and .not() with make blocklist', () => {
    const calls: { method: string; args: any[] }[] = [];
    const mockQuery = {
      or: (...args: any[]) => { calls.push({ method: 'or', args }); return mockQuery; },
      not: (...args: any[]) => { calls.push({ method: 'not', args }); return mockQuery; },
    };

    const result = applyNonAutoFilters(mockQuery);

    expect(result).toBe(mockQuery);
    expect(calls).toHaveLength(2);

    // First call: .or() with type whitelist
    expect(calls[0].method).toBe('or');
    expect(calls[0].args[0]).toContain('canonical_vehicle_type.in.(CAR,TRUCK,SUV,VAN,MINIVAN)');
    expect(calls[0].args[0]).toContain('canonical_vehicle_type.is.null');

    // Second call: .not() with make blocklist
    expect(calls[1].method).toBe('not');
    expect(calls[1].args[0]).toBe('make');
    expect(calls[1].args[1]).toBe('in');
    expect(calls[1].args[2]).toContain('HARLEY-DAVIDSON');
    expect(calls[1].args[2]).toContain('WINNEBAGO');
    expect(calls[1].args[2]).not.toContain('Yamaha');
    expect(calls[1].args[2]).not.toContain('Triumph');
  });
});
