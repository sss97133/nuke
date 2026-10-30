// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixture, VEHICLE, OTHER } from '../../services/__tests__/listingEvidenceFixture';
const state = vi.hoisted(() => ({ invoke: vi.fn(), createExport: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: state.invoke } } }));
vi.mock('../../hooks/useNukeEstimate', () => ({ useNukeEstimate: () => ({ data: null, isLoading: false }) }));
vi.mock('../../services/listingExportService', () => ({ ListingExportService: { createExport: state.createExport } }));
vi.mock('../listing/PlatformPreview', () => ({ default: () => null }));
import NukeEstimatePanel from './NukeEstimatePanel';
import ListingComposerModal from '../listing/ListingComposerModal';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.invoke.mockReset(); state.createExport.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
const click = (text: string) => act(async () => button(text).click());
const composer = (id = VEHICLE, onClose = vi.fn()) => act(async () => root.render(<ListingComposerModal vehicleId={id}
  vehicleName="Unverified SD455 Firebird" isOpen onClose={onClose} selectedPlatforms={['bat']} />));
const panel = (id = VEHICLE) => act(async () => root.render(<NukeEstimatePanel vehicleId={id} vehicle={{}} />));

it('composer shows four sections, attributed testimony and unknown configuration without copying the engine into editable text', async () => {
  state.invoke.mockResolvedValue({ data: fixture(), error: null }); await composer();
  for (const text of ['Market context', 'Comparison class', 'Commentary', 'Photo audit', 'needs cited supporting evidence', 'I believe it is an SD455.']) expect(host.textContent).toContain(text);
  expect([...host.querySelectorAll('textarea')].some(t => t.value.includes('SD455'))).toBe(false);
  expect(host.querySelector('input')?.value).not.toContain('SD455');
  expect(host.querySelector('a[href="https://bringatrailer.com/listing/fixture/"]')).not.toBeNull();
});
it('invalid or failed package keeps draft saving unavailable without raw vehicle fallback', async () => {
  state.invoke.mockResolvedValue({ data: { identity: { engine_type: 'SD455' } }, error: null }); await composer();
  expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(button('SAVE AS DRAFT').disabled).toBe(true);
  expect(state.createExport).not.toHaveBeenCalled();
});
it('failed draft save retains edited text, stays open, and allows retry with its evidence snapshot', async () => {
  const close = vi.fn(); state.invoke.mockResolvedValue({ data: fixture(), error: null });
  state.createExport.mockResolvedValueOnce({ success: false, error: 'Storage unavailable' }).mockResolvedValueOnce({ success: true });
  await composer(VEHICLE, close); await click('SAVE AS DRAFT');
  expect(close).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toBe('Storage unavailable');
  expect(host.querySelector('textarea')?.value).toBe('Source-reported make: Pontiac.');
  await click('SAVE AS DRAFT'); expect(close).toHaveBeenCalledOnce();
  expect(state.createExport.mock.calls[1][0].metadata.assessment.attestations[0].statement).toBe('I believe it is an SD455.');
  expect(state.createExport.mock.calls[1][0].metadata.owner_draft_changes.status).toBe('draft_edits_not_mechanical_verification');
});
it('late package for a previous vehicle cannot populate the new composer', async () => {
  let finish!: (v: unknown) => void;
  state.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ data: fixture(OTHER), error: null });
  await composer(); await composer(OTHER); await act(async () => finish({ data: { ...fixture(), listing_content: { ...fixture().listing_content, title: 'Wrong previous car' } }, error: null }));
  expect(host.querySelector('input')?.value).not.toBe('Wrong previous car'); expect(button('SAVE AS DRAFT').disabled).toBe(false);
});
it('evidence button uses the read-only action and preserves a successful assessment after a failed refresh', async () => {
  state.invoke.mockResolvedValueOnce({ data: { action: 'assessment', read_only: true, assessment: fixture().assessment }, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
  await panel(); await click('Review evidence');
  expect(state.invoke).toHaveBeenCalledWith('compute-vehicle-valuation', { body: { action: 'assessment', vehicle_id: VEHICLE } });
  expect(host.querySelector('section[aria-label="Vehicle evidence assessment"]')).not.toBeNull();
  await click('Review evidence'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('section[aria-label="Vehicle evidence assessment"]')).not.toBeNull();
});
it('late evidence review cannot render on another vehicle and loading never invents signal percentages', async () => {
  let finish!: (v: unknown) => void;
  state.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await panel(); await click('Review evidence'); expect(host.querySelector('[role="status"]')?.textContent).toContain('Reading retained evidence');
  expect(host.querySelector('[style*="width: 30%"]')).toBeNull(); await panel(OTHER);
  await act(async () => finish({ data: { action: 'assessment', read_only: true, assessment: fixture().assessment }, error: null }));
  expect(host.querySelector('section[aria-label="Vehicle evidence assessment"]')).toBeNull();
});
