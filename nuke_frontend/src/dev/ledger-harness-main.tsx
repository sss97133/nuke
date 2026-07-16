// THROWAWAY DEV ENTRY — used only by /ledger-harness.html on the vite dev
// server. Not referenced by index.html, so `vite build` never bundles it.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import '../styles/vehicle-profile.css';
import { supabase } from '../lib/supabase';
import LedgerHarness, { FIXTURE_ROWS } from './LedgerHarness';

// Intercept the RPC the hook calls so the real component + real hook render
// fixture data without any change to either. Everything else errors loudly.
(supabase as unknown as { rpc: unknown }).rpc = async (fn: string) => {
  if (fn === 'get_vehicle_build_ledger') return { data: FIXTURE_ROWS, error: null };
  return { data: null, error: { message: `harness: unmocked rpc ${fn}` } };
};

// The agent panel's transport. Stubbed so the harness exercises the real component
// (seed-on-Answer, thread rendering, invalidate-on-write) with no network and no
// model. It must never reach the live agent-chat from a fixture vehicle.
// `functions` is a getter that mints a fresh FunctionsClient on every access, so
// patching the returned object does nothing — redefine the getter itself. Without
// this the harness reaches the live agent-chat with a fixture vehicle id.
Object.defineProperty(supabase, 'functions', {
  configurable: true,
  get: () => ({
    invoke: async (_fn: string, opts: { body?: { messages?: { content: string }[] } }) => {
      const last = opts?.body?.messages?.at(-1)?.content ?? '';
      return {
        data: { reply: `harness stub — the live agent would answer:\n"${last}"`, actions: [] },
        error: null,
      };
    },
  }),
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LedgerHarness />
  </React.StrictMode>
);
