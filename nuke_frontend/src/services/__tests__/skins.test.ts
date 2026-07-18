import { describe, it, expect } from 'vitest';
import { validateSkinSpec, resolveBinding } from '../skinSpec';
import { SKIN_SEEDS, getSkinSeed } from '../skinSeeds';

describe('skin seeds are valid, evidence-carrying specs', () => {
  it('every seeded spec passes validation and cites its source', () => {
    for (const slug of Object.keys(SKIN_SEEDS)) {
      const spec = SKIN_SEEDS[slug];
      const r = validateSkinSpec(spec);
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(spec.evidence.source_url || spec.evidence.snapshot_id).toBeTruthy();
    }
  });

  it('resolves by slug and rejects unknown venues', () => {
    expect(getSkinSeed('bring-a-trailer-4')?.displayName).toBe('Bring a Trailer');
    expect(getSkinSeed('bonhams-cars')?.camp).toBe('spa');
    expect(getSkinSeed('not-a-venue')).toBeNull();
  });

  it('rejects a spec with no evidence (skin must be sourced, not asserted)', () => {
    const bad = { ...SKIN_SEEDS['bring-a-trailer-4'], evidence: {} };
    expect(validateSkinSpec(bad).ok).toBe(false);
  });
});

describe('binding resolution + transform DSL', () => {
  const atoms = { year: 1970, make: 'Ford', model: 'Mustang Boss 302', trim: '', mileage: 52000, vin: '0F02G143640' };
  it('joins multi-field bindings and skips empties', () => {
    expect(resolveBinding('year make model trim', atoms)).toBe('1970 Ford Mustang Boss 302');
  });
  it('abbreviates mileage with |abbrevK', () => {
    expect(resolveBinding('mileage|abbrevK', atoms)).toBe('52k');
  });
  it('passes through a single field', () => {
    expect(resolveBinding('vin', atoms)).toBe('0F02G143640');
  });
});
