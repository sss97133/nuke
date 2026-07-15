/**
 * valueFreshness — dated facts on the value surface decay; this makes the age
 * visible and grades it. THEORY (ask-nuke): "Every comp carries observed_at;
 * confidence decays. Staleness is structural." A 20-month-old comp is the
 * verdict's weakest joint, not a current fact — so we never render a dated
 * number without its age, and we mark the stale ones.
 *
 * Co-located with VehicleBriefing + EyeLedgerPopup (the two value surfaces that
 * consume it). Deliberately tiny — one function, no dependency on the scattered
 * timeAgo variants elsewhere, which are for different surfaces (dashboards).
 */

export type FreshnessTier = 'fresh' | 'aging' | 'stale';

export interface Freshness {
  days: number;
  months: number;
  tier: FreshnessTier;
  /** compact age, e.g. "1 day", "3 mo", "2 yr" */
  label: string;
  /** greyscale-friendly token for the tier (design system: no color reliance) */
  color: string;
  /** opacity to fade stale evidence without hiding it */
  opacity: number;
}

// Thresholds match the appraisal doctrine's evidence-decay language:
// a comp inside a quarter is current; past a year it's a weak joint.
const AGING_DAYS = 120;   // ~4 months — confidence starts decaying
const STALE_DAYS = 365;   // a year — cite it, but mark it weak

/**
 * Grade a dated fact by its age. `now` is injectable for deterministic tests.
 * Returns null when there is no date — callers must render "date unknown"
 * rather than silently implying freshness.
 */
export function freshnessOf(iso: string | null | undefined, now: number = Date.now()): Freshness | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / 86400000));
  const months = Math.floor(days / 30.44);

  const tier: FreshnessTier = days >= STALE_DAYS ? 'stale' : days >= AGING_DAYS ? 'aging' : 'fresh';

  let label: string;
  if (days < 1) label = 'today';
  else if (days === 1) label = '1 day';
  else if (days < 60) label = `${days} days`;
  else if (months < 24) label = `${months} mo`;
  else label = `${Math.floor(days / 365)} yr`;

  const color =
    tier === 'stale' ? 'var(--error, #d13438)'
    : tier === 'aging' ? 'var(--warning, #b8860b)'
    : 'var(--success, #004225)';
  const opacity = tier === 'stale' ? 0.55 : tier === 'aging' ? 0.8 : 1;

  return { days, months, tier, label, color, opacity };
}

/** "1 day ago" / "3 mo ago" — for pills that want the trailing "ago". */
export function agoLabel(iso: string | null | undefined, now: number = Date.now()): string {
  const f = freshnessOf(iso, now);
  if (!f) return 'date unknown';
  if (f.days < 1) return 'today';
  return `${f.label} ago`;
}
