// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ vehicle: {} as any, assessment: null as any, reads: [] as any[] }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ vehicle: fixture.vehicle }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/popups/usePopup', () => ({ usePopup: () => ({ openPopup: vi.fn() }) }));
vi.mock('./hooks/useFieldEvidence', () => ({ useFieldEvidence: () => ({ evidence: {}, loading: false }) }));
vi.mock('./hooks/useVehiclePriceFacts', () => ({ useVehiclePriceFacts: () => ({ priceFacts: null }), priceKindLabel: () => null }));
vi.mock('./FieldProvenanceDrawer', () => ({ default: () => null, SourceBadge: () => null }));
vi.mock('../../lib/supabase', () => ({ supabase: {
  from: (table: string) => ({ select: (fields: string) => ({ eq: (key: string, subject: string) => {
    fixture.reads.push({ table, fields, key, subject });
    return {
      maybeSingle: () => Promise.resolve({ data: fixture.assessment }),
      order: () => ({ limit: () => Promise.resolve({ data: fixture.assessment ? [fixture.assessment] : [] }) }),
    };
  } }) }),
} }));

import VehicleScoresWidget from './VehicleScoresWidget';
import { ConditionScoreSection } from './VehicleDossierPanel';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.vehicle = { id: 'offline-public-subject' }; fixture.assessment = null; fixture.reads = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(surface: 'dossier' | 'widget') {
  await act(async () => root.render(surface === 'dossier'
    ? <ConditionScoreSection vehicleId={fixture.vehicle.id} /> : <VehicleScoresWidget />));
}

describe.each(['dossier', 'widget'] as const)('stored condition: %s', surface => {
  it('preserves the reported score and same-subject existing read without implying condition matching', async () => {
    fixture.assessment = { condition_score: 56, condition_tier: 'driver', exterior_score: 80, mechanical_score: 60, provenance_score: 20 };
    const before = JSON.stringify(fixture.assessment);
    await mount(surface);
    expect(host.textContent).toContain('56');
    expect(host.textContent).toContain('Inputs, method and assessment time unavailable'.replace('Inputs', surface === 'widget' ? 'Condition inputs' : 'Inputs'));
    expect(host.textContent).toContain('Condition matching unverified');
    expect(host.textContent).not.toContain('CONDITION SPECTROMETER');
    expect(host.querySelector('[style*="var(--success)"], [style*="var(--warning)"], [style*="var(--error)"]')).toBeNull();
    expect(fixture.reads).toHaveLength(1);
    expect(fixture.reads[0]).toMatchObject({ table: 'vehicle_condition_scores', key: 'vehicle_id', subject: fixture.vehicle.id });
    expect(fixture.reads[0].fields).not.toMatch(/descriptor_summary|input_ids|image_ids/);
    expect(JSON.stringify(fixture.assessment)).toBe(before);
  });

  it('retains a genuine reported zero', async () => {
    fixture.assessment = { condition_score: 0 };
    await mount(surface);
    expect(host.textContent).toContain(surface === 'widget' ? '0/100' : '0/ 100');
    expect(host.textContent).toContain('Condition matching unverified');
  });

  it.each([null, undefined, NaN, Infinity, -1, 101])('does not manufacture a score from %s', async score => {
    fixture.assessment = { condition_score: score };
    await mount(surface);
    expect(host.textContent).toBe('');
  });

  it('keeps an absent assessment quiet', async () => {
    await mount(surface);
    expect(host.textContent).toBe('');
  });
});

it('preserves distinct domain scores as neutral reported numbers, with unknown overall score', async () => {
  fixture.assessment = { condition_score: null, mechanical_score: 60, provenance_score: 0, presentation_score: null };
  await mount('dossier');
  expect(host.textContent).toContain('Unknown');
  expect(host.textContent).toContain('MECHANICAL60');
  expect(host.textContent).toContain('PROVENANCE0');
  expect(host.textContent).not.toContain('PRESENTATION');
  expect(host.textContent).not.toContain('0/ 100');
});

it('qualifies a reported percentile without inventing its comparison group or denominator', async () => {
  fixture.assessment = { condition_score: 56, percentile_within_ymm: 88.5 };
  await mount('dossier');
  expect(host.textContent).toContain('Reported percentile: 88.5');
  expect(host.textContent).toContain('comparison group, size and eligibility unavailable');
  expect(host.textContent).not.toContain('th percentile');
});

it('preserves other stored scores when condition is unavailable, without a condition qualification shell', async () => {
  fixture.vehicle.provenance_score = 34;
  await mount('widget');
  expect(host.textContent).toContain('Provenance');
  expect(host.textContent).toContain('34');
  expect(host.textContent).not.toContain('Condition inputs');
});

it('uses an accessible toggle that retains the reported score after expanding', async () => {
  fixture.assessment = { condition_score: 56 };
  await mount('widget');
  const button = host.querySelector('button[title="Toggle vehicle scores"]')!;
  expect(button.getAttribute('aria-expanded')).toBe('true');
  await act(async () => button.click());
  expect(button.getAttribute('aria-expanded')).toBe('false');
  await act(async () => button.click());
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('Reported condition');
  expect(host.textContent).toContain('56/100');
});
