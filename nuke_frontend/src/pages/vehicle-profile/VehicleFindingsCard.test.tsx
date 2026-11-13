// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import VehicleFindingsCard, { imageAnalysisPopulations } from './VehicleFindingsCard';
import type { GalleryAnalysisRead } from '../../components/images/ImageGallery';

let root: Root, host: HTMLDivElement, read: GalleryAnalysisRead;
const select = vi.fn(), retry = vi.fn();
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  select.mockReset(); retry.mockReset();
  read = { vehicleId: 'vehicle', viewerKey: 'anonymous', status: 'ready', partial: false, readAt: '2026-11-09T22:00:00Z', images: [
    { id: 'both', ai_scan_metadata: { classification: { image_type: 'vehicle_exterior' }, byok_deep_analysis: { scene_type: 'body_exterior', build_phase_guess: 'unknown' } } },
    { id: 'classification', ai_scan_metadata: { classification: { image_type: 'engine_bay' } } },
    { id: 'detail', ai_scan_metadata: { byok_deep_analysis: { scene_type: 'body_interior', build_phase_guess: 'interior' }, engine_badge: 'NOT AN ENGINE FACT', license_plate: 'PRIVATE PLATE' } },
    { id: 'unread', ai_scan_metadata: null },
  ] };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(viewerKey = 'anonymous', vehicleId = 'vehicle') {
  await act(async () => root.render(<VehicleFindingsCard vehicleId={vehicleId} viewerKey={viewerKey} read={read} onSelectImages={select} onRetry={retry} />));
}
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

it('separates classification from detailed observations over the same gallery denominator', async () => {
  await mount();
  expect(host.textContent).toContain('4 of 4 gallery images');
  expect(button('Show 2 photo classification images').textContent).toBe('2 / 4');
  expect(button('Show 2 detailed observations images').textContent).toBe('2 / 4');
  expect(button('Show 1 no analysis record images').textContent).toBe('1 / 4');
  expect(host.textContent).toContain('same image can have both');
  expect(host.textContent).not.toContain('images analyzed');
  expect(host.textContent).not.toContain('PRIVATE PLATE');
  expect(host.textContent).not.toContain('NOT AN ENGINE FACT');
  expect(host.querySelector('[style]')).toBeNull();
});
it('opens exactly the counted images, including a detailed-only record', async () => {
  await mount();
  await act(async () => button('Show 2 detailed observations images').click());
  expect(select).toHaveBeenLastCalledWith(['both', 'detail'], 'Detailed observations');
  await act(async () => button('Show 1 photo subjects: engine bay images').click());
  expect(select).toHaveBeenLastCalledWith(['classification'], 'Photo subjects: engine bay');
  await act(async () => button('Show 1 recorded build phases: unknown images').click());
  expect(select).toHaveBeenLastCalledWith(['both'], 'Recorded build phases: unknown');
});
it('updates membership when a source is withdrawn from the gallery inventory', async () => {
  await mount(); read = { ...read, images: read.images.filter(image => image.id !== 'both') }; await mount();
  expect(host.textContent).toContain('3 of 3 gallery images');
  await act(async () => button('Show 1 detailed observations images').click());
  expect(select).toHaveBeenCalledWith(['detail'], 'Detailed observations');
});
it('withholds old counts after a vehicle or viewer change', async () => {
  await mount(); await mount('owner');
  expect(host.textContent).toBe('Reading image analysis…');
  await mount('anonymous', 'other-vehicle');
  expect(host.querySelector('button')).toBeNull();
});
it('distinguishes a failed read from successful empty data and offers retry', async () => {
  read.status = 'error'; await mount();
  expect(host.querySelector('[role=alert]')?.textContent).toContain('could not be read');
  expect(host.textContent).not.toContain('4 of 4');
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(retry).toHaveBeenCalledOnce();
  read = { ...read, status: 'ready', images: [] }; await mount();
  expect(host.textContent).toBe('');
});
it('qualifies partial inventory and retains actionable loaded cohorts', async () => {
  read.partial = true; await mount();
  expect(host.textContent).toContain('loaded gallery images');
  expect(host.querySelector('[role=status]')?.textContent).toContain('Only part');
  await act(async () => button('Show 2 photo classification images').click());
  expect(select).toHaveBeenCalledWith(['both', 'classification'], 'Photo classification');
});
it('retains legacy deep records without counting overlapping fields twice', () => {
  const images = [{ id: 'old', ai_scan_metadata: { classifier: 'caller-byok-cascade', scene_class: 'body_interior', phase: 'interior', byok_deep_analysis: { scene_type: 'body_interior', build_phase_guess: 'interior' } } }];
  const result = imageAnalysisPopulations([...images, ...images]);
  expect(result.total).toBe(1); expect(result.detailed).toEqual(['old']);
  expect(result.scenes).toEqual([{ label: 'body interior', ids: ['old'] }]);
  expect(result.phases).toEqual([{ label: 'interior', ids: ['old'] }]);
});
it('does not count empty metadata or unrelated completion clocks as analysis', () => {
  expect(imageAnalysisPopulations([{ id: 'empty', ai_scan_metadata: { classification: {}, byok_deep_analysis: {}, vision_analyzed_at: '2026-11-09' } }]).unread).toEqual(['empty']);
});
it('separates source-cited current reviews from legacy and incomplete analysis', async () => {
  read.images = [
    { id: 'reviewed', ai_scan_metadata: { byok_deep_analysis: { scene_type: 'body_interior', prompt_version: 'reviewed_image_analysis_v1', observation_id: '11111111-1111-4111-8111-111111111111' } } },
    { id: 'legacy', ai_scan_metadata: { classifier: 'caller-byok-cascade', scene_class: 'body_exterior' } },
    { id: 'incomplete', ai_scan_metadata: { byok_deep_analysis: { scene_type: 'unknown', prompt_version: 'reviewed_image_analysis_v1' } } },
  ];
  await mount();
  expect(button('Show 3 detailed observations images').textContent).toBe('3 / 3');
  await act(async () => button('Show 1 reviewed images').click());
  expect(select).toHaveBeenLastCalledWith(['reviewed'], 'Reviewed');
});
