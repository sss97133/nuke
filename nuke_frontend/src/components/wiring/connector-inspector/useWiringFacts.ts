// connector-inspector/useWiringFacts.ts — the wiring facts landed in vehicle_observations
// (docs/wiring/calc-data/load_observations.py, receipt 2026-09-26_facts-into-nuke-db.md), grouped by wire.
// Each fact carries its paper: the source that backs it, the page excerpt, what the citation check found,
// and — for parts — the proof on file that it was lined up, bought, installed. Read-only; skins never write.

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export interface PartProof {
  lined_up: { doc: string; vendor?: string; cart?: string; captured?: string; qty?: number } | null;
  bought: unknown | null;
  installed: unknown | null;
}

export interface WiringFact {
  id: string;
  plug: string;
  plugName: string;
  wireId: string | null;
  property: string;          // 'wire' | 'ECU end' | 'firewall' | 'device end' | 'tool' | 'plug / kit' | ...
  value: string;
  state: 'cited' | 'bench' | 'open' | 'deferred' | string;
  check: string | null;      // VERIFIED | PARTIAL | NOT_FOUND | STORED_PROSE | UNSTORED | SELF_ONLY
  sourceSlug: string;
  sourceName: string;
  url: string | null;
  excerpt: string | null;
  page: number | null;
  confidence: string | null;
  proof: PartProof | null;
}

export interface WiringFacts {
  loaded: boolean;
  error: string | null;
  byWire: Record<string, WiringFact[]>;   // lower-case wire id
  byPlug: Record<string, WiringFact[]>;   // plug-level facts (kit, tools, open items)
  total: number;
}

const EMPTY: WiringFacts = { loaded: false, error: null, byWire: {}, byPlug: {}, total: 0 };

interface FactRow {
  id: string;
  structured_data: {
    plug?: string; plug_name?: string; wire_id?: string | null; property_key?: string; row_field?: string;
    value?: unknown; state?: string; check?: { status?: string }; proof?: PartProof;
  } | null;
  source_url: string | null;
  citation_excerpt: string | null;
  citation_page_number: number | null;
  confidence: string | null;
  source: { slug?: string; display_name?: string } | null;
}

export function useWiringFacts(vehicleId: string | undefined): WiringFacts {
  const [facts, setFacts] = useState<WiringFacts>(EMPTY);
  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('vehicle_observations')
        .select('id, structured_data, source_url, citation_excerpt, citation_page_number, confidence, source:observation_sources(slug, display_name)')
        .eq('vehicle_id', vehicleId)
        .eq('kind', 'specification')
        .eq('is_superseded', false)
        .eq('structured_data->>domain', 'wiring')
        .limit(3000);
      if (cancelled) return;
      if (error) { setFacts({ ...EMPTY, loaded: true, error: error.message }); return; }
      const byWire: Record<string, WiringFact[]> = {};
      const byPlug: Record<string, WiringFact[]> = {};
      for (const row of (data ?? []) as unknown as FactRow[]) {
        const sd = row.structured_data ?? {};
        const src = row.source ?? {};
        const f: WiringFact = {
          id: row.id,
          plug: sd.plug ?? '', plugName: sd.plug_name ?? sd.plug ?? '',
          wireId: sd.wire_id ? String(sd.wire_id).toLowerCase() : null,
          property: sd.property_key ?? sd.row_field ?? '',
          value: String(sd.value ?? ''),
          state: sd.state ?? '',
          check: sd.check?.status ?? null,
          sourceSlug: src.slug ?? '', sourceName: src.display_name ?? src.slug ?? '',
          url: row.source_url ?? null,
          excerpt: row.citation_excerpt ?? null,
          page: row.citation_page_number ?? null,
          confidence: row.confidence ?? null,
          proof: sd.proof ?? null,
        };
        if (f.wireId) (byWire[f.wireId] ??= []).push(f);
        else (byPlug[f.plug] ??= []).push(f);
      }
      setFacts({ loaded: true, error: null, byWire, byPlug, total: data?.length ?? 0 });
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);
  return facts;
}

// Plain words for what the paper shows (owner 2026-09-26: proof or no proof).
export const CHECK_WORDS: Record<string, string> = {
  VERIFIED: 'PAPER CHECKED',
  PARTIAL: 'PAPER PARTLY MATCHES',
  NOT_FOUND: 'NOT IN THE PAPER CITED',
  STORED_PROSE: 'PAPER KEPT — NOT MACHINE-CHECKED',
  UNSTORED: 'PAPER NOT KEPT',
  NEVER_FETCHED: 'PAPER NEVER FETCHED',
  SELF_ONLY: 'OUR DESIGN RECORD',
};
export const STATE_WORDS: Record<string, string> = {
  bench: 'BENCH CHECK', open: 'OPEN', deferred: 'FORMBOARD',
};
