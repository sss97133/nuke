import { supabase } from '../supabase';
import { KNOWN_MAKES, MAKE_ALIASES } from './dictionaries';

export interface ResolvedMarketScope {
  make: string;
  family?: string;
  family_name?: string;
  model?: string;
  year?: number;
  era?: string;
}

interface FamilyMarketRow {
  brand: string;
  family_key: string;
  family: string | null;
  model_key: string;
  model: string | null;
  sold: number | null;
  usd: number | null;
}

// Cultural / generational shorthands that map directly to a canonical brand + family/model query
const CULTURAL_SCOPE_ALIASES: Array<{
  pattern: RegExp;
  make: string;
  familyHint: string;
  modelHint?: string;
  era?: string;
}> = [
  {
    pattern: /\b(square\s*body|squarebody|73\s*[-–/to]+\s*87\s*(gm|chevy|chevrolet|gmc)?(\s*trucks?|\s*pickups?|\s*c\/?k)?)\b/i,
    make: 'Chevrolet',
    familyHint: 'C10',
    era: '1973-1987',
  },
  {
    pattern: /\b(action\s*line|67\s*[-–/to]+\s*72\s*(gm|chevy|chevrolet|gmc)?(\s*trucks?|\s*pickups?|\s*c\/?k)?)\b/i,
    make: 'Chevrolet',
    familyHint: 'C10',
    era: '1967-1972',
  },
  {
    pattern: /\b(fox\s*body|foxbody)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    era: '1979-1993',
  },
  {
    pattern: /\b(early\s*bronco)\b/i,
    make: 'Ford',
    familyHint: 'Bronco',
    era: '1966-1977',
  },
  {
    pattern: /\b(shelby\s*gt\s*350\w*)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Shelby GT350',
  },
  {
    pattern: /\b(shelby\s*gt\s*500\w*)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Shelby GT500',
  },
  {
    pattern: /\b(boss\s*302)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Mustang Boss 302',
  },
  {
    pattern: /\b(boss\s*429)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Mustang Boss 429',
  },
  {
    pattern: /\b(mach\s*1)\b/i,
    make: 'Ford',
    familyHint: 'Mustang',
    modelHint: 'Mustang Mach 1',
  },
];

// Words that indicate a natural-language filter query rather than a market scope drill
const NL_FILTER_WORDS = /\b(under|over|below|above|less\s+than|more\s+than|between|near|within|miles|mileage|clean\s+title|salvage|no\s+reserve|with\s+a|without)\b|\$\d/i;

export function isOnMarketTab(pathname: string, search: string): boolean {
  if (pathname !== '/') return false;
  const tab = new URLSearchParams(search).get('tab');
  return !tab || tab === 'market';
}

export function buildMarketScopeUrl(scope: ResolvedMarketScope, currentSearch = ''): string {
  const next = new URLSearchParams(currentSearch);
  next.set('tab', 'market');
  next.set('make', scope.make);
  if (scope.family) next.set('family', scope.family);
  else next.delete('family');
  if (scope.family_name) next.set('family_name', scope.family_name);
  else next.delete('family_name');
  if (scope.model) next.set('model', scope.model);
  else next.delete('model');
  if (scope.year != null && Number.isFinite(scope.year)) next.set('year', String(scope.year));
  else next.delete('year');
  if (scope.era) next.set('era', scope.era);
  else next.delete('era');
  ['lot', 'inspect', 'board', 'mapFocus', 'mapChild'].forEach((k) => next.delete(k));
  return `/?${next.toString()}`;
}

/**
 * Resolves a human search query on the Market page ("mustang", "ford mustang", "1967 mustang",
 * "corvette", "squarebody", "73-87 gm trucks", "porsche 911 gt3") to a Market URL scope.
 * Returns null if the query is a complex filter query or does not match any known brand/family.
 */
export async function resolveMarketScopeQuery(rawQuery: string): Promise<ResolvedMarketScope | null> {
  const q = rawQuery.trim();
  if (!q || q.length > 80) return null;
  if (NL_FILTER_WORDS.test(q)) return null;

  // 1. Check cultural / generational shorthand first ("squarebody", "73-87 gm trucks", "fox body", "shelby gt350", etc.)
  for (const alias of CULTURAL_SCOPE_ALIASES) {
    if (alias.pattern.test(q)) {
      const resolved = await lookupFamilyInMarket(alias.make, alias.familyHint, alias.modelHint ?? null, null);
      if (resolved) return { ...resolved, ...(alias.era ? { era: alias.era } : {}) };
      return { make: alias.make, model: alias.modelHint ?? alias.familyHint, ...(alias.era ? { era: alias.era } : {}) };
    }
  }

  // 2. Extract optional 4-digit year (e.g. "1967 ford mustang" or "mustang 1967")
  let year: number | null = null;
  let rest = q;
  const yearMatch = rest.match(/(?:^|\s)((?:19[0-9]{2}|20[0-2][0-9]))(?:\s|$)/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    rest = rest.replace(yearMatch[0], ' ').trim();
  }

  const normalized = rest.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();

  // 3. Check if the entire remaining string is just a brand ("ford", "chevy", "porsche", "mercedes-benz")
  const directMake = matchBrandOnly(lower);
  if (directMake && year == null) {
    return { make: directMake };
  }

  // 4. Split leading brand if present ("ford mustang mach 1" -> make: "Ford", remainder: "mustang mach 1")
  const { make, remainder } = splitLeadingBrand(normalized);
  const targetTerm = (remainder || normalized).trim();
  if (!targetTerm) {
    return make ? { make } : null;
  }

  return lookupFamilyInMarket(make, targetTerm, remainder ? remainder : null, year);
}

function matchBrandOnly(lower: string): string | null {
  const cleaned = lower.replace(/[^a-z0-9\s-]/g, '').trim();
  if (MAKE_ALIASES[cleaned]) return MAKE_ALIASES[cleaned];
  const found = KNOWN_MAKES.find((m) => m.toLowerCase() === cleaned);
  return found ?? null;
}

function splitLeadingBrand(text: string): { make: string | null; remainder: string } {
  const lower = text.toLowerCase();
  // Check two-word brands first ("alfa romeo", "aston martin", "land rover", "mercedes benz", "rolls royce", "de tomaso")
  const candidates: Array<{ phrase: string; canonical: string }> = [
    ...KNOWN_MAKES.map((m) => ({ phrase: m.toLowerCase(), canonical: m })),
    ...KNOWN_MAKES.filter((m) => m.includes('-')).map((m) => ({ phrase: m.toLowerCase().replace(/-/g, ' '), canonical: m })),
    ...Object.entries(MAKE_ALIASES).map(([k, v]) => ({ phrase: k.toLowerCase(), canonical: v })),
  ].sort((a, b) => b.phrase.length - a.phrase.length);

  for (const c of candidates) {
    if (lower === c.phrase) {
      return { make: c.canonical, remainder: '' };
    }
    if (lower.startsWith(`${c.phrase} `)) {
      return { make: c.canonical, remainder: text.slice(c.phrase.length).trim() };
    }
  }
  return { make: null, remainder: text };
}

async function lookupFamilyInMarket(
  make: string | null,
  term: string,
  explicitModelHint: string | null,
  year: number | null,
): Promise<ResolvedMarketScope | null> {
  const cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return make ? { make } : null;

  try {
    let query = supabase
      .from('mv_family_market')
      .select('brand, family_key, family, model_key, model, sold, usd')
      .neq('family_key', 'other')
      .gt('sold', 0)
      .order('usd', { ascending: false })
      .limit(100);

    if (make) {
      query = query.eq('brand', make);
    }
    const firstWord = cleanTerm.split(/[\s-]+/)[0];
    if (firstWord && firstWord.length >= 2) {
      query = query.ilike('model_key', `%${firstWord}%`);
    }

    const { data, error } = await Promise.resolve(query);
    if (error || !data || !Array.isArray(data) || data.length === 0) {
      return make ? { make, model: explicitModelHint ?? term, ...(year ? { year } : {}) } : null;
    }

    const rows = data as FamilyMarketRow[];
    // Aggregate families by (brand, family_key) so we pick the highest-dollar family whose name or model matches
    const families = new Map<string, {
      brand: string;
      familyKey: string;
      familyName: string;
      totalUsd: number;
      exactFamily: boolean;
      exactModel: string | null;
      prefixModel: string | null;
    }>();

    for (const r of rows) {
      if (!r.family || !r.family_key || r.family_key === 'other') continue;
      const famLower = r.family.toLowerCase();
      const modLower = (r.model_key || r.model || '').toLowerCase();
      const isExactFamily = famLower === cleanTerm;
      const isExactModel = modLower === cleanTerm;
      const isFamilyPrefix = cleanTerm.startsWith(`${famLower} `) || cleanTerm.startsWith(`${famLower}-`);
      const isModelMatch = modLower.includes(cleanTerm) || cleanTerm.includes(famLower);

      if (!isExactFamily && !isExactModel && !isFamilyPrefix && !isModelMatch) continue;

      const key = `${r.brand}:${r.family_key}`;
      const prev = families.get(key) ?? {
        brand: r.brand,
        familyKey: r.family_key,
        familyName: r.family,
        totalUsd: 0,
        exactFamily: false,
        exactModel: null,
        prefixModel: null,
      };
      prev.totalUsd += Number(r.usd) || 0;
      if (isExactFamily) prev.exactFamily = true;
      if (isExactModel && r.model) prev.exactModel = r.model;
      else if (isFamilyPrefix && modLower.includes(cleanTerm) && r.model && !prev.prefixModel) {
        prev.prefixModel = r.model;
      }
      families.set(key, prev);
    }

    const best = [...families.values()].sort((a, b) => {
      if (a.exactFamily !== b.exactFamily) return a.exactFamily ? -1 : 1;
      if ((a.exactModel != null) !== (b.exactModel != null)) return a.exactModel != null ? -1 : 1;
      return b.totalUsd - a.totalUsd;
    })[0];

    if (!best) {
      return make ? { make } : null;
    }

    // If the user typed a sub-model ("mustang mach 1", "911 gt3") or a specific year ("1967 mustang"), include model
    const subModel = explicitModelHint && explicitModelHint.toLowerCase() !== best.familyName.toLowerCase()
      ? explicitModelHint
      : !best.exactFamily
        ? (best.exactModel ?? best.prefixModel ?? undefined)
        : (year != null ? (best.exactModel ?? best.familyName) : undefined);

    return {
      make: best.brand,
      family: best.familyKey,
      family_name: best.familyName,
      ...(subModel ? { model: subModel } : {}),
      ...(year != null ? { year } : {}),
    };
  } catch {
    return make ? { make } : null;
  }
}
