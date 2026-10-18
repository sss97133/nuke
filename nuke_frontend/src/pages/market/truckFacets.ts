import type { TreemapNode } from '../HomePage';
import { classifyVehicleFacets } from '../familyFacetsAndEmblems';
import { getDefinedFamilyEras } from '../../lib/market/familyEras';

export const TRUCK_AXES = ['drive', 'wheelbase', 'bed', 'body', 'tonnage', 'era', 'series', 'year', 'raw'] as const;
export type TruckAxis = typeof TRUCK_AXES[number];
export type TruckFilters = Partial<Record<TruckAxis, string>>;
export const TRUCK_AXIS_LABELS: Record<TruckAxis, string> = {
  drive: 'Drivetrain', wheelbase: 'Wheelbase', bed: 'Bed length', body: 'Cab / body', tonnage: 'Nominal class', era: 'Era', series: 'Series', year: 'Year', raw: 'Recorded names',
};
export type TruckMember = {
  id: string; model: string | null; year: number | null; usd: number; source: string | null;
  sale_date: string | null; family: string | null; drive: string | null; body: string | null;
  cab: string | null; series: string | null; trim: string | null;
  drive_observed_at: string | null; drive_observation_id: string | null;
};
export type TruckRead = { members: TruckMember[]; n: number; asOf: string; truncated: boolean };
export function parseTruckMembers(value: unknown): TruckRead | null {
  const v = value as Record<string, unknown> | null;
  if (!v || !Array.isArray(v.rows) || !Number.isInteger(v.n) || typeof v.as_of !== 'string' || typeof v.truncated !== 'boolean') return null;
  const members: TruckMember[] = [];
  const ids = new Set<string>();
  for (const r of v.rows) {
    if (!Array.isArray(r) || r.length !== 14 || typeof r[0] !== 'string' || ids.has(r[0]) ||
      typeof r[3] !== 'number' || !Number.isFinite(r[3]) || r[3] <= 0 ||
      r.some((x, i) => i !== 2 && i !== 3 && x != null && typeof x !== 'string') ||
      (r[2] != null && !Number.isInteger(r[2]))) return null;
    ids.add(r[0]);
    members.push({ id: r[0], model: r[1], year: r[2], usd: r[3], source: r[4], sale_date: r[5],
      family: r[6], drive: r[7], body: r[8], cab: r[9], series: r[10], trim: r[11], drive_observed_at: r[12], drive_observation_id: r[13] });
  }
  if ((v.n as number) < members.length || (!v.truncated && v.n !== members.length)) return null;
  return { members, n: v.n as number, asOf: v.as_of, truncated: v.truncated };
}

/** A model designation is identity evidence, never current drivetrain evidence. */
export function truckFacet(member: TruckMember, axis: TruckAxis, make: string): string {
  if (axis === 'raw') return member.model || 'Unknown recorded name';
  if (axis === 'year') return member.year == null ? 'Unknown year' : String(member.year);
  if (axis === 'drive') return ({ RWD: '2WD', FWD: '2WD', '4WD': '4WD', AWD: 'AWD', conflict: 'Conflicting drivetrain' } as Record<string, string>)[member.drive ?? ''] ?? 'Unknown drivetrain';
  const raw = [member.model, member.series].filter(Boolean).join(' ');
  const series = classifyVehicleFacets(make, 'Truck', raw, member.year).series?.replace(/\s*\([^)]*\)$/, '') ??
    (member.family && member.family !== 'Pickup' ? member.family : null);
  if (axis === 'series') return series ?? 'Unresolved series';
  if (axis === 'tonnage') {
    const label = classifyVehicleFacets(make, 'Truck', raw, member.year).series ?? '';
    if (label.includes('1/2-Ton')) return '½-ton series';
    if (label.includes('3/4-Ton')) return '¾-ton series';
    if (label.includes('1-Ton')) return '1-ton series';
    return 'Unknown nominal class';
  }
  if (axis === 'wheelbase' || axis === 'bed' || axis === 'body') {
    const text = [member.model, member.body, member.cab].filter(Boolean).join(' ');
    if (axis === 'body') {
      const kinds = [
        [/\bcab\s*(?:&|and|[-/])\s*chassis\b|\bchassis cab\b/i, 'Cab & chassis'],
        [/\bcrew[ -]?cab\b/i, 'Crew cab'], [/\b(extended[ -]?cab|extra[ -]?cab)\b/i, 'Extended cab'],
        [/\b(regular[ -]?cab|single[ -]?cab)\b/i, 'Regular cab'],
      ] as const;
      const found = kinds.filter(([pattern]) => pattern.test(text));
      return found.length > 1 ? 'Conflicting cab / body' : found[0]?.[1] ?? 'Unknown cab / body';
    }
    const short = axis === 'wheelbase' ? /\b(swb|short[ -]?wheelbase)\b/i.test(text) : /\bshort[ -]?(bed|box)\b/i.test(text);
    const long = axis === 'wheelbase' ? /\b(lwb|long[ -]?wheelbase)\b/i.test(text) : /\blong[ -]?(bed|box)\b/i.test(text);
    return short && long ? `Conflicting ${axis === 'bed' ? 'bed length' : 'wheelbase'}`
      : short ? (axis === 'bed' ? 'Short bed' : 'SWB')
      : long ? (axis === 'bed' ? 'Long bed' : 'LWB') : `Unknown ${axis === 'bed' ? 'bed length' : 'wheelbase'}`;
  }
  if (member.year == null) return 'Unknown era';
  const eraFamily = series && /^(?:[CKRV](?:10|20|30)|[CK]?(?:1500|2500|3500))$/.test(series) ? 'C10' : series ?? '';
  const eras = getDefinedFamilyEras(make, eraFamily).filter(e => member.year! >= e.yearStart && member.year! <= e.yearEnd);
  if (eras.length > 1) return `${member.year} (era unresolved)`;
  const era = eras[0];
  // A model-year decade is explicitly a fallback, not a manufactured generation.
  return era?.label ?? `${Math.floor(member.year / 10) * 10}s (year band)`;
}
export function readTruckNavigation(params: URLSearchParams): { axis: TruckAxis | 'vehicles'; filters: TruckFilters } {
  const group = params.get('truck_group');
  const axis = group === 'vehicles' || TRUCK_AXES.includes(group as TruckAxis) ? group as TruckAxis | 'vehicles' : 'series';
  const filters: TruckFilters = {};
  for (const a of TRUCK_AXES) { const value = params.get(`truck_${a}`); if (value) filters[a] = value; }
  return { axis, filters };
}
export function filterTruckMembers(members: readonly TruckMember[], filters: TruckFilters, make: string): TruckMember[] {
  return members.filter(m => TRUCK_AXES.every(a => !filters[a] || truckFacet(m, a, make) === filters[a]));
}
export function partitionTruckMembers(members: readonly TruckMember[], axis: TruckAxis | 'vehicles', make: string): TreemapNode[] {
  const groups = new Map<string, TreemapNode>();
  for (const m of members) {
    const key = axis === 'vehicles' ? m.id : truckFacet(m, axis, make);
    const existing = groups.get(key);
    if (existing) { existing.count++; existing.usd = (existing.usd ?? 0) + m.usd; existing.value += m.usd; }
    else groups.set(key, { name: axis === 'vehicles' ? [m.year, make, m.model].filter(Boolean).join(' ') : key,
      count: 1, usd: m.usd, value: m.usd, ...(axis === 'vehicles' ? { id: m.id, isVehicle: true } : {}) });
  }
  return [...groups.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
