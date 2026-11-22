// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('../../lib/supabase', () => ({ get supabase() { return fixture.client; } }));
import AnalysisStreamPage from './AnalysisStreamPage';

const vehicleId = '2e61fa34-c5b4-4709-9636-4823546a5bc4';
let root: Root, host: HTMLDivElement, urls: URL[];

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  urls = [];
  fixture.client = createClient('https://fixture.supabase.co', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input)));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': '*/0' } });
    } },
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('reads only standing readings: not superseded, not automatic tier, untiered rows kept', async () => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[`/vehicle/${vehicleId}/analysis-stream`]}>
      <Routes><Route path="/vehicle/:vehicleId/analysis-stream" element={<AnalysisStreamPage />} /></Routes>
    </MemoryRouter>);
  });
  const reads = urls.filter((u) => u.pathname === '/rest/v1/vehicle_observations');
  expect(reads.length).toBeGreaterThan(0);
  for (const u of reads) {
    expect(u.searchParams.get('is_superseded')).toBe('not.is.true');
    expect(u.searchParams.get('or')).toBe('(agent_tier.is.null,agent_tier.neq.subscription automatic)');
  }
});
