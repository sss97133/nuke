/**
 * skinSpec.ts
 * ---------------------------------------------------------------------------
 * A skin is a venue's REAL design language rendered over the one universal
 * vehicle profile. The spec is reverse-engineered from authentic captured
 * markup (never memory) and stored on the venue org's `brand_design_language`.
 * VenueSkin reads a spec + a vehicle and renders the profile in that frame.
 *
 * Provenance: every spec carries `evidence` (the snapshot it came from) so a
 * skin is testimony like everything else in Nuke — not an asserted theme.
 */

export type SkinCamp = 'clean' | 'spa';

export interface SkinPalette {
  pageBg: string;      // outer page background
  surface: string;     // content card background
  text: string;
  muted: string;
  border: string;
  accent: string;      // primary action background (e.g. BaT's black button)
  accentText?: string; // text on accent
  link?: string;
  headerBg?: string;   // venues with a dark masthead (Bonhams)
  headerText?: string;
}

export interface SkinTokens {
  fontFamily: string;
  /** Optional @import URL (e.g. Google Fonts) — null when self-hosted/unconfirmed. */
  fontImportUrl?: string | null;
  headingFontFamily?: string;
  palette: SkinPalette;
}

/** Ordered, named sections — the structural skeleton extracted from the source page. */
export type SkinSectionId =
  | 'header' | 'gallery' | 'tags' | 'title' | 'meta'
  | 'availability' | 'essentials' | 'chassis' | 'estimate' | 'description'
  | 'specs' | 'bidbar' | 'comments' | 'reply' | 'feedback' | 'callout';

/** Layout regions. 'top' spans full width above the columns; main/sidebar form the two-column body. */
export type SkinRegion = 'top' | 'main' | 'sidebar';

/** Page layout. 'single' = one column (default); 'sidebar-right' = full-width top + main|sidebar columns (BaT, eBay). */
export type SkinLayout = 'single' | 'sidebar-right';

export interface SkinSection {
  id: SkinSectionId;
  /** The venue's real heading text, e.g. "BaT Essentials", "Estimate", "Chassis no." */
  label?: string;
  /** Ordered binding keys (resolved against `bindings`) or literal tag strings. */
  items?: string[];
  /** Which region this section renders in (for non-'single' layouts). Defaults to 'top'. */
  region?: SkinRegion;
}

export interface SkinSpec {
  venue: string;        // org slug
  displayName: string;  // "Bring a Trailer"
  camp: SkinCamp;
  /** Page layout. Omitted/'single' = one column; 'sidebar-right' = top band + main|sidebar. */
  layout?: SkinLayout;
  tokens: SkinTokens;
  structure: SkinSection[];
  /** slot key → vehicle-atom path or "path|transform" (e.g. "mileage|abbrevK"). */
  bindings: Record<string, string>;
  /** Where this spec was reverse-engineered from. font_confirmed=false flags an unverified token. */
  evidence: { snapshot_id?: string; source_url?: string; font_confirmed?: boolean };
  /** Homage marker shown in the skin chrome. */
  homage: string;
}

export interface SkinValidation {
  ok: boolean;
  errors: string[];
}

/** Lightweight structural validation — keeps DB-stored specs honest without a heavy schema lib. */
export function validateSkinSpec(x: unknown): SkinValidation {
  const e: string[] = [];
  const s = x as Partial<SkinSpec> | null;
  if (!s || typeof s !== 'object') return { ok: false, errors: ['spec is not an object'] };
  if (!s.venue) e.push('missing venue');
  if (!s.displayName) e.push('missing displayName');
  if (s.camp !== 'clean' && s.camp !== 'spa') e.push("camp must be 'clean' or 'spa'");
  if (!s.tokens?.fontFamily) e.push('missing tokens.fontFamily');
  if (!s.tokens?.palette?.text) e.push('missing tokens.palette.text');
  if (!s.tokens?.palette?.surface) e.push('missing tokens.palette.surface');
  if (!Array.isArray(s.structure) || s.structure.length === 0) e.push('structure must be a non-empty array');
  if (!s.bindings || typeof s.bindings !== 'object') e.push('missing bindings');
  if (!s.evidence || (!s.evidence.snapshot_id && !s.evidence.source_url)) {
    e.push('missing evidence (a skin must cite the source it was derived from)');
  }
  return { ok: e.length === 0, errors: e };
}

/**
 * Resolve a binding against a vehicle-like atom bag. Supports a tiny transform DSL:
 *   "vin"                → vehicle.vin
 *   "mileage|abbrevK"    → "52k" from 52000
 *   "year make model"    → space-joined fields
 */
export function resolveBinding(binding: string, atoms: Record<string, any>): string {
  const [pathPart, transform] = binding.split('|');
  const raw = pathPart.trim().split(/\s+/).map((p) => atoms[p]).filter((v) => v != null && v !== '').join(' ');
  if (!transform) return raw;
  if (transform === 'abbrevK') {
    const n = Number(raw);
    return Number.isFinite(n) ? `${Math.round(n / 1000)}k` : raw;
  }
  if (transform === 'usd') {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? `$${Math.round(n).toLocaleString()}` : raw;
  }
  if (transform === 'commas') {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.round(n).toLocaleString() : raw;
  }
  return raw;
}
