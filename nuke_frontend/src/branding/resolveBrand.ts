/**
 * resolveBrand — turn a brand *reference* into a full BrandIdentity.
 *
 * For the v1 R&D prototype the reference comes from a `?brand=` query param so
 * Skylar can SEE the reskin without rewiring production subdomain routing:
 *
 *   ?brand=monogram:Desert+Performance:gulf:Built+to+win   (synthetic, no DB)
 *   ?brand=org:<slug>        (real business: name + logo + livery from ui_config)
 *   ?brand=vehicle:<uuid>    (a single car's life rebrands the whole app)
 *
 * The same resolver is what a subdomain router would call later — the reference
 * source changes, the resolution doesn't.
 */

import { supabase } from '../lib/supabase';
import { coerceAccent, type BrandIdentity } from './brandIdentity';
import { canProject } from '../entity/entityProof';

export function readBrandRef(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('brand');
}

function shortNameFrom(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.slice(0, 14);
}

async function resolveOrg(slug: string): Promise<BrandIdentity | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id, business_name, slug, logo_url, description, ui_config')
    .eq('slug', slug)
    .maybeSingle();
  if (!data) return null;
  // Projection gate: refuse to wear an org with no formation proof (step 5).
  if (!(await canProject('organization', data.id))) {
    console.warn(`[resolveBrand] org "${data.slug || data.id}" has no formation proof — not wearable.`);
    return null;
  }
  const accent = coerceAccent(data.ui_config?.storefront?.accentColor);
  return {
    kind: 'org',
    subjectId: data.slug || data.id,
    name: (data.business_name || 'Shop').toUpperCase(),
    shortName: shortNameFrom(data.business_name || 'Shop'),
    logoUrl: data.logo_url ?? null,
    accent,
    tagline: data.description ?? null,
    startPath: `/org/${data.slug || data.id}`,
  };
}

async function resolveVehicle(id: string): Promise<BrandIdentity | null> {
  const { data } = await supabase
    .from('vehicles')
    .select('id, year, make, model, hero_image_url')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  if (!(await canProject('vehicle', data.id))) {
    console.warn(`[resolveBrand] vehicle "${data.id}" has no formation proof — not wearable.`);
    return null;
  }
  const name = [data.year, data.make, data.model].filter(Boolean).join(' ') || 'My Vehicle';
  return {
    kind: 'vehicle',
    subjectId: data.id,
    name: name.toUpperCase(),
    shortName: shortNameFrom([data.make, data.model].filter(Boolean).join(' ') || name),
    logoUrl: data.hero_image_url ?? null,
    accent: 'neutral',
    tagline: `${name} — the whole story`,
    startPath: `/vehicle/${data.id}`,
  };
}

function resolveSynthetic(rest: string): BrandIdentity | null {
  // monogram:<name>:<accent>:<tagline?>   (name/tagline use + for spaces)
  const [rawName, rawAccent, rawTagline] = rest.split(':');
  if (!rawName) return null;
  const name = decodeURIComponent(rawName).replace(/\+/g, ' ');
  return {
    kind: 'synthetic',
    subjectId: null,
    name: name.toUpperCase(),
    shortName: shortNameFrom(name),
    logoUrl: null,
    accent: coerceAccent(rawAccent),
    tagline: rawTagline ? decodeURIComponent(rawTagline).replace(/\+/g, ' ') : null,
    startPath: '/',
  };
}

export async function resolveBrand(ref: string): Promise<BrandIdentity | null> {
  const idx = ref.indexOf(':');
  const kind = idx === -1 ? ref : ref.slice(0, idx);
  const rest = idx === -1 ? '' : ref.slice(idx + 1);

  switch (kind) {
    case 'org':
      return resolveOrg(rest);
    case 'vehicle':
      return resolveVehicle(rest);
    case 'monogram':
    case 'synthetic':
      return resolveSynthetic(rest);
    default:
      return null;
  }
}
