// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: fixture }));
vi.mock('../components/PrefetchLink', () => ({ default: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
import ScriptControlCenter from './ScriptControlCenter';
const row = (processed: unknown = '12') => ({ script_id: 'gap-finder', source_table: 'missing_context_reports', processed, computed: true, note: null });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.rpc.mockReset(); fixture.from.mockReset();
  fixture.rpc.mockResolvedValue({ data: [row(), { script_id: 'angle-setter', source_table: 'vehicle_images', processed: null, computed: false, note: 'Retained assay: count exceeds interactive budget.' }], error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const render = async () => { await act(async () => root.render(<ScriptControlCenter/>)); };
const click = async (name: string) => { await act(async () => [...host.querySelectorAll('button')].find(e=>e.textContent === name)!.click()); };

it('shows recorded coverage and unavailable counts without manufacturing operational metrics or raw scans', async () => {
  await render();
  expect(host.querySelector('[aria-label="Gap Identification"] dd')?.textContent).toBe('12');
  expect(host.querySelector('[aria-label="Angle Detection"]')?.textContent).toContain('Not computed');
  expect(host.textContent).toContain('Retained assay: count exceeds interactive budget.');
  for (const value of ['100%', '2,742', '0m', 'Trigger Now', 'TOTAL COST', 'ACTIVE SCRIPTS']) expect(host.textContent).not.toContain(value);
  expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('admin_script_center_progress');
  expect(fixture.from).not.toHaveBeenCalled();
  expect(host.querySelector('a[href="/admin/sources"]')).not.toBeNull();
});
it.each([null, '', -1, 'invalid', '9007199254740993'])('keeps invalid or absent count %s unknown', async value => {
  fixture.rpc.mockResolvedValue({data:[row(value)],error:null}); await render();
  expect(host.querySelector('[aria-label="Gap Identification"] dd')?.textContent).toBe('Not computed');
});
it('preserves a recorded zero as zero', async () => {
  fixture.rpc.mockResolvedValue({data:[row('0')],error:null}); await render();
  expect(host.querySelector('[aria-label="Gap Identification"] dd')?.textContent).toBe('0');
});
it('exposes a failed read and supports retry without claiming empty coverage', async () => {
  fixture.rpc.mockResolvedValueOnce({data:null,error:{message:'read unavailable'}});
  await render(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Coverage unavailable');
  expect(host.querySelectorAll('section')).toHaveLength(0);
  await click('Refresh coverage');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[aria-label="Gap Identification"] dd')?.textContent).toBe('12');
});
it('labels retained coverage when a refresh fails', async () => {
  await render(); fixture.rpc.mockRejectedValueOnce(new Error('Temporary read failure'));
  await click('Refresh coverage');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('showing the last loaded coverage');
  expect(host.querySelector('[aria-label="Gap Identification"] dd')?.textContent).toBe('12');
});
it('refreshes only when requested, and skips automatic reads in a hidden page', async () => {
  vi.useFakeTimers(); await render();
  await act(async () => { vi.advanceTimersByTime(120000); });
  expect(fixture.rpc).toHaveBeenCalledTimes(1);
  await click('Auto-refresh off');
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { vi.advanceTimersByTime(60000); });
  expect(fixture.rpc).toHaveBeenCalledTimes(2);
  visible.mockReturnValue('hidden');
  await act(async () => { vi.advanceTimersByTime(60000); });
  expect(fixture.rpc).toHaveBeenCalledTimes(2); visible.mockRestore();
});
