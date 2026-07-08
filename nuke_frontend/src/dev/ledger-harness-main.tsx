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

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LedgerHarness />
  </React.StrictMode>
);
