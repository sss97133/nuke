// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import CowlTagExtract from './CowlTagExtract';
import { publicCowlTagExtract, publicObservationData, publicCowlTagFields, sameReviewedImage } from './observationPrivacy';

const state = vi.hoisted(() => ({ provenance: null as any, inventory: null as any, witnesses: [] as any[] }));
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: null, loading: false }) }));
vi.mock('./hooks/useFieldProvenance', async original => ({
  ...await original<typeof import('./hooks/useFieldProvenance')>(),
  useFieldProvenance: () => ({ data: state.provenance, isLoading: false, isError: false }),
}));
vi.mock('./hooks/useVehicleImageEvidence', () => ({
  useVehicleImageEvidence: () => ({ data: state.inventory, isLoading: false, isError: false }),
  readImageWitnesses: () => Promise.resolve({ data: state.witnesses, error: null }),
}));
const data = { decode_rule: 'cowl_tag_decode_v1', claim_role: 'cowl_tag_paint', visual_relation: 'direct_code',
  paint_code: '75', paint_code_secondary: '75', reviewed_sha256: 'a'.repeat(64), image_id: 'image-1', factory_color: 'Private Person', reviewed_url: 'https://example.invalid/current.jpg',
  line1: 'Private Person', image_url: 'https://private.invalid/original', reference: { url: 'https://private.invalid/name' } };
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.replaceChildren(); });

it('only projects two-digit paint tokens, never raw tag lines, decoded names or URLs', () => {
  expect(publicCowlTagExtract(data)).toEqual({ lower: '75', upper: '75' });
  expect(publicObservationData(data)).toEqual({});
  for (const patch of [{ paint_code: '75 Private Person' }, { paint_code_secondary: '7\n5' },
    { paint_code: 75 }, { decode_rule: 'unknown' }, { claim_role: 'title' }, { visual_relation: 'inferred' }]) {
    expect(publicCowlTagExtract({ ...data, ...patch })).toBeNull();
  }
});

it('binds reviewed Storage renditions to the same object without accepting replacement paths or version parameters', () => {
  const current = 'https://storage.example.invalid/storage/v1/object/public/images/tag.heic';
  const reviewed = 'https://storage.example.invalid/storage/v1/render/image/public/images/tag.heic?width=1600&quality=90';
  expect(sameReviewedImage(reviewed, current)).toBe(true);
  expect(sameReviewedImage(reviewed.replace('tag.heic', 'other.heic'), current)).toBe(false);
  expect(sameReviewedImage(reviewed + '&version=old', current)).toBe(false);
  expect(sameReviewedImage(reviewed.replace('storage.example.invalid', 'other.invalid'), current)).toBe(false);
  expect(sameReviewedImage(null, current)).toBe(false);
});

it('requires exact current vehicle, observation and witness before displaying the digital extract', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  state.provenance = { vehicle_id: 'vehicle-1', field: 'factory_color', coverage: { status: 'complete_current_reader' },
    image_observations: [{ observation_id: 'observation-1', image_id: 'image-1', image_url: 'https://example.invalid/current.jpg',
      source_url: 'https://example.invalid/current.jpg', claim_role: 'cowl_tag_paint', visual_relation: 'direct_code' }] };
  state.inventory = { complete: true, images: [{ id: 'image-1', image_url: 'https://example.invalid/current.jpg' }] };
  state.witnesses = [{ witness_role: 'derived', observation: { id: 'observation-1', vehicle_id: 'vehicle-1',
    extraction_method: 'cowl_tag_decode_v1', is_superseded: false, structured_data: data } }, { witness_role: 'derived', observation: { id: 'style-1', vehicle_id: 'vehicle-1', extraction_method: 'cowl_tag_decode_v1', is_superseded: false, structured_data: { ...data, claim_role: 'cowl_tag_transcription', tag_model_year: '73', assembly_plant_code: 'N', fisher_style_number: '2FS87' } } }];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = () => act(async () => { root.render(<QueryClientProvider client={client}><CowlTagExtract vehicleId="vehicle-1" observationId="observation-1" sourceImageId="image-1" /></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 20)); });
  await render();
  await render();
  expect(host.querySelector('svg')?.getAttribute('aria-label')).toContain('lower paint 75; upper paint 75');
  expect(host.innerHTML).not.toMatch(/Private Person|private.invalid|<img|href=/);
  state.provenance.vehicle_id = 'other'; await render(); expect(host.querySelector('figure')).toBeNull();
  state.provenance.vehicle_id = 'vehicle-1';
  state.provenance.image_observations[0].observation_id = 'other'; await render(); expect(host.querySelector('figure')).toBeNull();
  state.provenance.image_observations[0].observation_id = 'observation-1';
  state.inventory.images[0].image_url = 'https://example.invalid/replaced.jpg'; await render(); expect(host.querySelector('figure')).toBeNull();
  state.inventory.images = []; await render(); expect(host.querySelector('figure')).toBeNull();
  state.inventory.complete = false; await render(); expect(host.querySelector('figure')).toBeNull();
});

it('reproduces only unique codes for the exact source, withholding conflicting fields and identifiers', () => {
  const row = (patch: any = {}) => ({ witness_role: 'derived', observation: { id: 'one', vehicle_id: 'vehicle-1',
    extraction_method: 'cowl_tag_decode_v1', is_superseded: false,
    structured_data: { ...data, claim_role: 'cowl_tag_transcription', tag_model_year: '73', fisher_style_number: '2FS87',
      interior_trim_code: '232', seat_code: 'A51', body_build_date_code: '07C', fisher_body_number: 'PRIVATE-SERIAL', cowl_tag_line5: 'PRIVATE-SEQUENCE', ...patch } } });
  const fields = publicCowlTagFields([row()], 'vehicle-1', 'image-1', 'https://example.invalid/current.jpg', 'a'.repeat(64));
  expect(fields).toMatchObject({ modelYear: '73', style: '2FS87', trim: '232', seat: 'A51', buildDate: '07C', paintLower: '75' });
  expect(JSON.stringify(fields)).not.toMatch(/PRIVATE|Person|https/);
  expect(publicCowlTagFields([row({ reviewed_sha256: 'b'.repeat(64) })], 'vehicle-1', 'image-1', data.reviewed_url, 'a'.repeat(64)).style).toBeUndefined();
  expect(publicCowlTagFields([row({ decode_rule: null })], 'vehicle-1', 'image-1', data.reviewed_url, 'a'.repeat(64)).style).toBeUndefined();
  expect(publicCowlTagFields([row(), row({ paint_code: '24' })], 'vehicle-1', 'image-1', data.reviewed_url, 'a'.repeat(64)).paintLower).toBeUndefined();
  expect(publicCowlTagFields([row()], 'other', 'image-1', data.reviewed_url, 'a'.repeat(64)).style).toBeUndefined();
  expect(publicCowlTagFields([row({ reviewed_url: 'https://example.invalid/old.jpg' })], 'vehicle-1', 'image-1', data.reviewed_url, 'a'.repeat(64)).style).toBeUndefined();
});
