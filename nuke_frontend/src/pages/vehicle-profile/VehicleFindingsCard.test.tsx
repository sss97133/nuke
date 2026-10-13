// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, owner: false, select: '' }));
vi.mock('./VehicleProfileContext', () => ({ useVehicleProfile: () => ({ isRowOwner: fixture.owner, isVerifiedOwner: false, hasContributorAccess: false }) }));
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ select: (s: string) => { fixture.select = s; return { eq: () => ({ limit: () => Promise.resolve({ data: fixture.rows, error: null }) }) }; } }) } }));
import VehicleFindingsCard from './VehicleFindingsCard';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fixture.owner = false;
  fixture.rows = [
    { byok_scene_type: 'exterior_front', byok_confidence: 0.9, vision_analyzed_at: '2026-06-23T22:24:03Z', license_plate: 'UT 04AP4', color_visible: 'factory_turquoise', make_guess: 'Ford' },
    { byok_scene_type: 'document', byok_confidence: 0.7, vision_analyzed_at: '2026-07-01T00:00:00Z', engine: '289ci V8', make_guess: 'Chevrolet', part_number: 'C5ZZ-6584-A' },
    { classifier: null },
  ];
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount() {
  await act(async () => root.render(<VehicleFindingsCard vehicleId="v-1" />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

it('states coverage with the newest analysis clock, masks the plate for a visitor and sets no inline style', async () => {
  await mount();
  expect(host.querySelector('section.k-section')).not.toBeNull();
  expect(host.textContent).toContain('2 of 3 images analyzed · Jul 1, 2026');
  expect(host.textContent).toContain('••••');
  expect(host.textContent).not.toContain('04AP4');
  expect(host.textContent).toContain('factory turquoise');
  expect(host.textContent).not.toContain('factory_turquoise');
  expect(host.textContent).toContain('289ci V8');
  expect(host.textContent).toContain('C5ZZ-6584-A');
  expect(host.textContent).not.toContain('contamination');
  expect(host.textContent).not.toContain('Mean reported confidence');
  expect(host.querySelector('[style]')).toBeNull();
  expect(fixture.select).toContain('vision_analyzed_at');
});

it('shows the plate and the pipeline diagnostics to the owner', async () => {
  fixture.owner = true;
  await mount();
  expect(host.textContent).toContain('UT 04AP4');
  expect(host.textContent).toContain('contamination signal');
  expect(host.textContent).toContain('Ford 1, Chevrolet 1');
  expect(host.textContent).toContain('Mean reported confidence');
  expect(host.textContent).toContain('0.80');
});

it('renders nothing when no image was analyzed', async () => {
  fixture.rows = [{ classifier: null }];
  await mount();
  expect(host.textContent).toBe('');
});
