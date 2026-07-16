// useLocalPartsReference.ts — Local-first parts lookup.
// Reads /build-plan/parts-reference.json (generated from MASTER_BOM.csv).
// O(1) lookup by SKU, name substring fallback. No network after initial fetch.
// This is a feature, not a Supabase fallback: the local JSON is authoritative
// for anything hand-curated in the build plan. Remote sources supplement, not
// replace.

import { useEffect, useState } from 'react';

export interface PartsReferenceEntry {
  sku: string;
  category: string | null;
  vendor: string | null;
  description: string | null;
  qty: number | null;
  unit_cost: number | null;
  total_cost: number | null;
  url: string | null;
  subharness: string | null;
  notes: string | null;
  source: string;
  source_trust: 'T1' | 'T2' | 'T3';
}

interface PartsReferenceDoc {
  version: number;
  generated_at: string;
  source_csv: string;
  entry_count: number;
  entries: Record<string, PartsReferenceEntry>;
}

type LoadState =
  | { status: 'loading'; doc: null }
  | { status: 'loaded'; doc: PartsReferenceDoc }
  | { status: 'missing'; doc: null };

let cache: LoadState | null = null;
let pending: Promise<LoadState> | null = null;

async function loadOnce(): Promise<LoadState> {
  if (cache) return cache;
  if (pending) return pending;
  pending = fetch('/build-plan/parts-reference.json')
    .then(r => (r.ok ? r.json() : null))
    .then((doc: PartsReferenceDoc | null): LoadState => {
      const next: LoadState = doc
        ? { status: 'loaded', doc }
        : { status: 'missing', doc: null };
      cache = next;
      return next;
    })
    .catch((): LoadState => {
      const next: LoadState = { status: 'missing', doc: null };
      cache = next;
      return next;
    });
  return pending;
}

export function useLocalPartsReference(): LoadState {
  const [state, setState] = useState<LoadState>(cache ?? { status: 'loading', doc: null });
  useEffect(() => {
    if (cache) {
      setState(cache);
      return;
    }
    let cancelled = false;
    loadOnce().then(next => {
      if (!cancelled) setState(next);
    });
    return () => { cancelled = true; };
  }, []);
  return state;
}

/** Look up by exact SKU, then by case-insensitive description substring match. */
export function findPart(doc: PartsReferenceDoc, query: string): PartsReferenceEntry | null {
  if (!query) return null;
  const direct = doc.entries[query];
  if (direct) return direct;
  const upper = query.toUpperCase();
  const directUpper = doc.entries[upper];
  if (directUpper) return directUpper;
  const q = query.toLowerCase();
  for (const entry of Object.values(doc.entries)) {
    if (entry.sku.toLowerCase() === q) return entry;
  }
  for (const entry of Object.values(doc.entries)) {
    if (entry.description && entry.description.toLowerCase().includes(q)) return entry;
  }
  return null;
}
