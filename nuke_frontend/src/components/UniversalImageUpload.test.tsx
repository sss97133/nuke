// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  recentWork: [] as any[],
  vehicles: [
    { id: 'vehicle-a', year: 1967, make: 'Synthetic', model: 'A' },
    { id: 'vehicle-b', year: 1970, make: 'Synthetic', model: 'B' },
  ],
  addFiles: vi.fn(), success: vi.fn(), close: vi.fn(),
}));
vi.mock('../services/globalUploadQueue', () => ({ uploadQueue: { addFiles: fixture.addFiles } }));
vi.mock('react-hot-toast', () => ({ default: { success: fixture.success, error: vi.fn() } }));
vi.mock('../lib/supabase', () => ({ supabase: {
  from(table: string) {
    if (!['vehicles', 'vehicle_timeline_events'].includes(table)) throw new Error('Unexpected table');
    const query: any = {
      select: () => query, eq: () => query, gte: () => query,
      order: () => table === 'vehicles' ? Promise.resolve({ data: fixture.vehicles }) : query,
      limit: () => Promise.resolve({ data: fixture.recentWork }),
    };
    return query;
  },
  rpc: vi.fn(() => { throw new Error('No actual GPS/model request permitted'); }),
} }));
import { UniversalImageUpload } from './UniversalImageUpload';

let container: HTMLDivElement, root: Root, file: File;
beforeEach(() => {
  vi.clearAllMocks(); fixture.recentWork = [];
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network calls permitted'); }));
  vi.stubGlobal('FileReader', class {
    onload: ((event: any) => void) | null = null;
    readAsArrayBuffer() { this.onload?.({ target: { result: new ArrayBuffer(1) } }); }
  });
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:synthetic-photo'; } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  file = new File(['synthetic pixels'], 'shop-photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
function recent(vehicleId: string) {
  const vehicle = fixture.vehicles.find(v => v.id === vehicleId)!;
  return { vehicle_id: vehicleId, vehicles: vehicle };
}
async function render(vehicleId?: string) {
  await act(async () => root.render(<UniversalImageUpload onClose={fixture.close}
    session={{ user: { id: 'synthetic-user' } }} vehicleId={vehicleId} prefillFiles={[file]} />));
  expect(container.querySelector('select')).not.toBeNull();
}
async function choose(vehicleId: string) {
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = vehicleId; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function upload() {
  await act(async () => container.querySelector<HTMLButtonElement>('.upload-button')!.click());
}

describe('photo-session assignment boundary', () => {
  it('keeps recent work as an unassigned suggestion and queues an honest inbox label', async () => {
    fixture.recentWork = [recent('vehicle-a')]; await render();
    expect(container.textContent).toContain('Suggested: 1967 Synthetic A');
    expect(container.textContent).toContain('Recent work history; select to assign');
    expect(container.querySelector('select')!.value).toBe('');
    await upload();
    expect(fixture.addFiles).toHaveBeenCalledExactlyOnceWith(null, 'Photo Inbox', [file]);
  });
  it('does not turn an arbitrary first candidate from ambiguous recent work into a binding', async () => {
    fixture.recentWork = [recent('vehicle-a'), recent('vehicle-b')]; await render(); await upload();
    expect(fixture.addFiles).toHaveBeenCalledExactlyOnceWith(null, 'Photo Inbox', [file]);
  });
  it('binds only the vehicle explicitly chosen from the selector, overriding recent context', async () => {
    fixture.recentWork = [recent('vehicle-a')]; await render(); await choose('vehicle-b');
    expect(container.querySelector('select')!.value).toBe('vehicle-b');
    expect(container.querySelector('.confidence')).toBeNull();
    await upload();
    expect(fixture.addFiles).toHaveBeenCalledExactlyOnceWith('vehicle-b', '1970 Synthetic B', [file]);
  });
  it('preserves the vehicle-page context even when recent work suggests another vehicle', async () => {
    fixture.recentWork = [recent('vehicle-a')]; await render('vehicle-b'); await upload();
    expect(fixture.addFiles).toHaveBeenCalledExactlyOnceWith('vehicle-b', '1970 Synthetic B', [file]);
  });
  it('clearing a context-bound vehicle queues unassigned rather than restoring the suggestion', async () => {
    fixture.recentWork = [recent('vehicle-a')]; await render('vehicle-b'); await choose(''); await upload();
    expect(fixture.addFiles).toHaveBeenCalledExactlyOnceWith(null, 'Photo Inbox', [file]);
  });
  it('shows an explicit context outside the owned-vehicle list as selected rather than unassigned', async () => {
    fixture.recentWork = [recent('vehicle-a')]; await render('context-vehicle');
    expect(container.querySelector('select')!.value).toBe('context-vehicle');
    expect(container.querySelector('select')!.selectedOptions[0].textContent).toBe('Selected vehicle');
    await upload();
    expect(fixture.addFiles).toHaveBeenCalledExactlyOnceWith('context-vehicle', 'Vehicle', [file]);
  });
});
