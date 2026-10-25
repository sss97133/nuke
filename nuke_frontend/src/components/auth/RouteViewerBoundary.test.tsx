// @vitest-environment jsdom
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';
import { RequireAdmin } from './RequireAdmin';

const auth = vi.hoisted(() => ({ user: { id: 'viewer-a' } as { id: string } | null, loading: false }));
const admin = vi.hoisted(() => ({ isAdmin: true, loading: false, refresh: vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../hooks/useAdminAccess', () => ({ useAdminAccess: () => admin }));

let host: HTMLDivElement, root: Root;
let completions: Map<string, (value: string) => void>;
function PrivatePage() {
  const [draft, setDraft] = useState('');
  const [result, setResult] = useState('');
  useEffect(() => {
    const viewer = auth.user!.id;
    void new Promise<string>(resolve => completions.set(viewer, resolve)).then(setResult);
  }, []);
  return <><button onClick={() => setDraft('private draft')}>Edit draft</button>
    <output aria-label="Draft">{draft}</output><output aria-label="Reader result">{result}</output></>;
}
function Location() { const loc = useLocation(); return <output aria-label="Location">{loc.pathname + loc.search}</output>; }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  auth.user = { id: 'viewer-a' }; auth.loading = false; admin.isAdmin = true; admin.loading = false;
  completions = new Map(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const output = (label: string) => host.querySelector(`[aria-label="${label}"]`)?.textContent;

for (const [name, Guard] of [['signed-in', ProtectedRoute], ['admin', RequireAdmin]] as const) {
  for (const nesting of ['children', 'outlet'] as const) {
    describe(`${name} ${nesting} viewer boundary`, () => {
      async function render() {
        await act(async () => root.render(<MemoryRouter initialEntries={['/private?tab=review']}><Location /><Routes>
          {nesting === 'children'
            ? <Route path="/private" element={<Guard><PrivatePage /></Guard>} />
            : <Route element={<Guard />}><Route path="/private" element={<PrivatePage />} /></Route>}
          <Route path="/login" element={<p>Sign in</p>} />
          <Route path="/org/dashboard" element={<p>Access denied</p>} />
        </Routes></MemoryRouter>));
      }
      it('discards private drafts and late reader results on an account switch', async () => {
        await render(); await act(async () => host.querySelector('button')!.click());
        expect(output('Draft')).toBe('private draft');
        const priorResponse = completions.get('viewer-a')!;
        auth.user = { id: 'viewer-b' }; await render();
        expect(output('Draft')).toBe('');
        await act(async () => priorResponse('viewer-a private result'));
        expect(output('Reader result')).toBe('');
        await act(async () => completions.get('viewer-b')!('viewer-b result'));
        expect(output('Reader result')).toBe('viewer-b result');
      });
      it('preserves drafts when the same account receives a refreshed auth object', async () => {
        await render(); await act(async () => host.querySelector('button')!.click());
        auth.user = { id: 'viewer-a' }; await render();
        expect(output('Draft')).toBe('private draft');
      });
      it('unmounts private content at sign-out and retains the return URL', async () => {
        await render(); auth.user = null; await render();
        expect(host.querySelector('button')).toBeNull();
        expect(output('Location')).toBe('/login?returnUrl=%2Fprivate%3Ftab%3Dreview');
      });
      it('does not mount a private reader while auth is resolving', async () => {
        auth.loading = true; await render();
        expect(completions.size).toBe(0); expect(host.textContent).toContain('Loading');
      });
      if (name === 'admin') it('keeps the existing admin denial', async () => {
        admin.isAdmin = false; await render();
        expect(completions.size).toBe(0); expect(output('Location')).toBe('/org/dashboard');
      });
    });
  }
}
