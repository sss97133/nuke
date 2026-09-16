/**
 * deriveModes — the modes a person can wear are NOT configured in a settings
 * panel. They're already enumerated by that person's edges in the graph:
 *
 *   - every org they contribute to (organization_contributors)  → a WORK mode
 *   - every ownership-CONFIRMED vehicle they hold               → a PERSONAL mode
 *
 * This is the "silent switch" source of truth. The multi-hat reality (a person
 * who is a technician here, a board member there, a photographer somewhere else)
 * falls out for free — each membership is the same person projected from a
 * different starting node.
 *
 * Integrity rule (cardinal): personal modes come ONLY from ownership_verified
 * vehicles. Scraped / created_by research vehicles are NOT the user's garage —
 * an empty personal list is an honest intake gap, never a fabricated roster.
 */

import { supabase } from '../lib/supabase';
import type { AccentId } from '../contexts/ThemeContext';
import type { BrandIdentity } from './brandIdentity';

export interface Mode extends BrandIdentity {
  /** Grouping for the switcher UI. */
  group: 'work' | 'personal';
  /** Human role/relationship label, e.g. "Technician" or "Owner". */
  role: string;
  /** How the role was established: self_claimed|owner_approval|proof_of_work|document. */
  verificationMethod?: string;
}

// Vivid liveries only (no 'neutral') so every derived mode reads distinctly.
const LIVERY_POOL: AccentId[] = [
  'gulf', 'martini', 'rosso', 'brg', 'jps', 'papaya', 'bmw-m', 'alitalia',
  'mopar-plum', 'mopar-sublime', 'route-66', 'denim', 'desert', 'flames-blue',
];

/** Stable livery from a slug so an org always wears the same color. */
function liveryForKey(key: string): AccentId {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return LIVERY_POOL[h % LIVERY_POOL.length];
}

function titleCaseRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function workModes(userId: string): Promise<Mode[]> {
  const { data } = await supabase
    .from('organization_contributors')
    .select('role, verification_method, organization_id, businesses!inner(id, business_name, slug, logo_url, ui_config)')
    .eq('user_id', userId);
  if (!data) return [];

  return data.map((row: any) => {
    const b = row.businesses;
    const slug = b.slug || b.id;
    const configured = b.ui_config?.storefront?.accentColor as AccentId | undefined;
    return {
      group: 'work' as const,
      role: titleCaseRole(row.role || 'member'),
      verificationMethod: row.verification_method,
      kind: 'org' as const,
      subjectId: slug,
      name: (b.business_name || 'Shop').toUpperCase(),
      shortName: (b.business_name || 'Shop').trim().split(/\s+/)[0].slice(0, 14),
      logoUrl: b.logo_url ?? null,
      accent: configured ?? liveryForKey(slug),
      tagline: `${titleCaseRole(row.role || 'member')} · ${b.business_name}`,
      startPath: `/org/${slug}`,
    };
  });
}

async function personalModes(userId: string): Promise<Mode[]> {
  // Ownership-CONFIRMED only. No scrapes, no created_by research vehicles.
  const { data } = await supabase
    .from('vehicles')
    .select('id, year, make, model, primary_image_url')
    .eq('owner_id', userId)
    .eq('ownership_verified', true)
    .not('make', 'is', null)
    .limit(25);
  if (!data) return [];

  return data.map((v: any) => {
    const name = [v.year, v.make, v.model].filter(Boolean).join(' ') || 'My Vehicle';
    return {
      group: 'personal' as const,
      role: 'Owner',
      kind: 'vehicle' as const,
      subjectId: v.id,
      name: name.toUpperCase(),
      shortName: [v.make, v.model].filter(Boolean).join(' ').slice(0, 14) || 'Vehicle',
      logoUrl: v.primary_image_url ?? null,
      accent: 'neutral',
      tagline: `${name} — your build`,
      startPath: `/vehicle/${v.id}`,
    };
  });
}

export interface DerivedModes {
  work: Mode[];
  personal: Mode[];
}

export async function deriveModes(userId: string): Promise<DerivedModes> {
  const [work, personal] = await Promise.all([workModes(userId), personalModes(userId)]);
  return { work, personal };
}

/**
 * Real geofence coords for the user's orgs, keyed by the mode subjectId (slug).
 * Returns only orgs that actually have shop_locations coords — empty is honest,
 * never a fabricated pin.
 */
export async function fetchModeCoords(userId: string): Promise<Record<string, { lat: number; lng: number }>> {
  const { data } = await supabase
    .from('organization_contributors')
    .select('businesses!inner(slug, id, shop_locations!inner(latitude, longitude))')
    .eq('user_id', userId);
  if (!data) return {};
  const out: Record<string, { lat: number; lng: number }> = {};
  for (const row of data as any[]) {
    const b = row.businesses;
    const loc = Array.isArray(b?.shop_locations) ? b.shop_locations[0] : b?.shop_locations;
    if (loc?.latitude != null && loc?.longitude != null) {
      out[b.slug || b.id] = { lat: Number(loc.latitude), lng: Number(loc.longitude) };
    }
  }
  return out;
}
