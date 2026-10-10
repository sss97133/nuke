// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ data: null as any }));
vi.mock('./hooks/useWorthEngine', () => ({ useWorthEngine: () => ({ data: fixture.data }) }));
vi.mock('../../components/ui/CollapsibleWidget', () => ({ CollapsibleWidget: ({ title, children }: any) => <section>{title}{children}</section> }));
import WorthEngineCard from './WorthEngineCard';
it('withholds photo-only labor and avoids presenting one method as a bracket', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  fixture.data = {
    substrate: { images: 418, atoms: 4, work_sessions: 0, work_sessions_independent: 0, burst_active_min: 0 },
    inferred_value: { available_method_count: 1, range_low_USD: 10000, range_high_USD: 10000, v2_available: true, v2_photo_count_USD: 10000 },
    documented_costs: { total_documented: 0, parts: 0, payments_out: 0 },
    magnitude_confidence: 'single_method', existence_confidence: 'low', warnings: [], open_substrate_gaps: [], methodology_note: '',
  };
  try {
    await act(async () => root.render(<WorthEngineCard vehicleId="fixture" />));
    expect(host.textContent).toBe('');
    fixture.data = { ...fixture.data, substrate: { ...fixture.data.substrate, work_sessions: 1, work_sessions_independent: 1 } };
    await act(async () => root.render(<WorthEngineCard vehicleId="fixture" />));
    expect(host.textContent).toContain('SINGLE AVAILABLE PROXY');
    expect(host.textContent).not.toContain('LOWEST AVAILABLE PROXY');
    expect(host.textContent).not.toContain('HIGHEST AVAILABLE PROXY');
    expect(host.textContent).toContain('do not establish performed hours');
    expect(host.textContent).toContain('—');
    fixture.data = { ...fixture.data, substrate: { ...fixture.data.substrate, images: 0, atoms: 0 }, documented_costs: { total_documented: 250, parts: 250, payments_out: 0 }, inferred_value: { available_method_count: 0 }, magnitude_confidence: 'no_methods' };
    await act(async () => root.render(<WorthEngineCard vehicleId="fixture" />));
    expect(host.textContent).toContain('No available labor model proxy.');
    expect(host.textContent).toContain('$250');
    expect(host.textContent).not.toContain('SINGLE AVAILABLE PROXY');
  } finally { await act(async () => root.unmount()); }
});
