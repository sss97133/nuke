/**
 * Custom hook: loads available makes, models, and body styles for feed filter autocomplete.
 * Extracted from CursorHomepage.
 */
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { getBodyStyleDisplay } from '../services/bodyStyleTaxonomy';

interface UseFeedFilterOptionsParams {
  selectedMakes: string[];
  runVehiclesQueryWithListingKindFallback: (builder: (includeListingKind: boolean) => any) => Promise<any>;
}

export function useFeedFilterOptions({ selectedMakes, runVehiclesQueryWithListingKindFallback }: UseFeedFilterOptionsParams) {
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableBodyStyles, setAvailableBodyStyles] = useState<string[]>([]);

  // Load available makes and body styles on mount
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const normalizeMake = (raw: unknown): string | null => {
          let s = String(raw ?? '').trim();
          if (!s) return null;
          if (s.length < 2 || s.length > 30) return null;
          if (/\d/.test(s)) {
            const parts = s.split(/\s+/).filter(Boolean);
            const keep: string[] = [];
            for (const p of parts) {
              if (/\d/.test(p)) break;
              keep.push(p);
            }
            const candidate = keep.join(' ').trim();
            if (!candidate) return null;
            s = candidate;
          }
          if (/[\u{1F300}-\u{1F9FF}]/u.test(s)) return null;
          if (/\b(for|with|powered|swap|engine|manual|auto|awd|4x4|parts|project)\b/i.test(s)) return null;
          if (!/^[A-Za-z][A-Za-z .'-]*$/.test(s)) return null;
          const cleaned = s.replace(/\s+/g, ' ').trim();
          const words = cleaned.split(' ').filter(Boolean);
          if (words.length > 3) return null;
          return cleaned;
        };

        // Prefer canonical makes if present
        const canonicalMakes: string[] = [];
        try {
          const { data: canonicalData, error: canonicalError } = await supabase
            .from('canonical_makes')
            .select('display_name, canonical_name, is_active')
            .eq('is_active', true)
            .limit(5000);
          if (!canonicalError && canonicalData) {
            for (const row of canonicalData as any[]) {
              const display = String(row?.display_name || '').trim();
              const canon = String(row?.canonical_name || '').trim();
              const name = display || canon;
              if (name) canonicalMakes.push(name);
            }
          }
        } catch {
          // ignore: canonical tables may not exist
        }

        const { data: makeData } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
          let q = supabase
            .from('vehicles')
            .select('make')
            .eq('is_public', true);
          if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
          return q.not('make', 'is', null).limit(5000);
        });

        const makeCounts = new Map<string, number>();
        for (const row of (makeData || []) as any[]) {
          const cleaned = normalizeMake(row?.make);
          if (!cleaned) continue;
          makeCounts.set(cleaned, (makeCounts.get(cleaned) || 0) + 1);
        }
        const frequentVehicleMakes = Array.from(makeCounts.entries())
          .filter(([, count]) => count >= 2)
          .map(([make]) => make);

        const merged = [...canonicalMakes, ...frequentVehicleMakes];
        const seenLower = new Set<string>();
        const uniqueMakes: string[] = [];
        for (const m of merged) {
          const cleaned = String(m || '').trim();
          if (!cleaned) continue;
          const key = cleaned.toLowerCase();
          if (seenLower.has(key)) continue;
          seenLower.add(key);
          uniqueMakes.push(cleaned);
        }
        uniqueMakes.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setAvailableMakes(uniqueMakes);

        // Body styles
        const canonicalBodyStyles: string[] = [];
        try {
          const { data: canonBody, error: canonBodyErr } = await supabase
            .from('canonical_body_styles')
            .select('display_name, canonical_name, is_active')
            .eq('is_active', true)
            .limit(5000);
          if (!canonBodyErr && Array.isArray(canonBody)) {
            for (const row of canonBody as any[]) {
              const display = String(row?.display_name || '').trim();
              const canon = String(row?.canonical_name || '').trim();
              const name = display || canon;
              if (name) canonicalBodyStyles.push(name);
            }
          }
        } catch {
          // ignore: canonical tables may not exist
        }

        const { data: bodyData } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
          let q = supabase
            .from('vehicles')
            .select('body_style')
            .eq('is_public', true);
          if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
          return q.not('body_style', 'is', null).limit(5000);
        });

        const counts = new Map<string, number>();
        for (const row of (bodyData || []) as any[]) {
          const raw = row?.body_style;
          const display = getBodyStyleDisplay(raw) || String(raw || '').trim();
          if (!display) continue;
          counts.set(display, (counts.get(display) || 0) + 1);
        }
        const frequentVehicleBodyStyles = Array.from(counts.entries())
          .filter(([, ct]) => ct >= 2)
          .map(([name]) => name);

        const mergedBody = [...canonicalBodyStyles, ...frequentVehicleBodyStyles];
        const seenBody = new Set<string>();
        const uniqueBody: string[] = [];
        for (const s of mergedBody) {
          const cleaned = String(s || '').trim();
          if (!cleaned) continue;
          const key = cleaned.toLowerCase();
          if (seenBody.has(key)) continue;
          seenBody.add(key);
          uniqueBody.push(cleaned);
        }
        uniqueBody.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setAvailableBodyStyles(uniqueBody);
      } catch {
        // Error loading filter options - silent
      }
    };

    loadFilterOptions();
  }, []);

  // Load models when selected makes change
  useEffect(() => {
    const loadModelsForMakes = async () => {
      if (!selectedMakes || selectedMakes.length === 0) {
        setAvailableModels([]);
        return;
      }
      try {
        const makeClauses = selectedMakes.map(m => `make.ilike.${m}`).join(',');
        const { data: modelData } = await runVehiclesQueryWithListingKindFallback((includeListingKind) => {
          let q = supabase
            .from('vehicles')
            .select('model')
            .eq('is_public', true)
            .neq('status', 'pending')
            .or(makeClauses)
            .not('model', 'is', null)
            .order('model', { ascending: true })
            .limit(2000);
          if (includeListingKind) q = q.eq('listing_kind', 'vehicle');
          return q;
        });

        if (modelData && Array.isArray(modelData)) {
          const baseModelMap = new Map<string, { display: string; count: number; variants: Set<string> }>();

          const extractBaseModel = (model: string): string => {
            const trimmed = model.trim();
            if (!trimmed) return '';
            const parts = trimmed.split(/\s+/);
            let base = parts[0];
            if (parts.length > 1) {
              const second = parts[1];
              const multiWordModels = ['cruiser', 'cherokee', 'wrangler', 'bronco', 'blazer', 'suburban',
                'camaro', 'corvette', 'mustang', 'challenger', 'charger', 'firebird', 'barracuda',
                'romeo', 'martin', 'rover'];
              if (multiWordModels.some(mw => second.toLowerCase() === mw)) {
                base = `${parts[0]} ${parts[1]}`;
              }
            }
            return base.charAt(0).toUpperCase() + base.slice(1);
          };

          for (const row of modelData as any[]) {
            const rawModel = String(row?.model || '').trim();
            if (!rawModel || rawModel.length < 1 || rawModel.length > 100) continue;
            if (rawModel === 'Unknown') continue;
            const baseModel = extractBaseModel(rawModel);
            if (!baseModel || baseModel.length < 1) continue;
            const key = baseModel.toLowerCase();
            const existing = baseModelMap.get(key);
            if (existing) {
              existing.count++;
              existing.variants.add(rawModel);
              if (rawModel.length <= existing.display.length && rawModel === rawModel.charAt(0).toUpperCase() + rawModel.slice(1)) {
                existing.display = rawModel.length < existing.display.length ? baseModel : existing.display;
              }
            } else {
              baseModelMap.set(key, { display: baseModel, count: 1, variants: new Set([rawModel]) });
            }
          }

          const sortedModels = Array.from(baseModelMap.entries())
            .sort((a, b) => b[1].count - a[1].count || a[1].display.localeCompare(b[1].display))
            .map(([, v]) => v.display);
          setAvailableModels(sortedModels);
        }
      } catch {
        // Error loading models - silent
      }
    };
    loadModelsForMakes();
  }, [selectedMakes]);

  return { availableMakes, availableModels, availableBodyStyles };
}
