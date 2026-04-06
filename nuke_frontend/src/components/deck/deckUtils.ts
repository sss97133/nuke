/**
 * Deck utility functions — logo selection, photo helpers.
 * Logo variant selection is systematic, not per-slide.
 */

export type BgType = 'light' | 'dark' | 'ford-blue' | 'marsh';

interface BrandLogos {
  svg?: string | null;
  primary_dark?: string | null;
  primary_light?: string | null;
  icon?: string | null;
  og_image?: string | null;
  all_variants?: string[];
}

interface BrandDesignLanguage {
  logos?: BrandLogos;
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
  };
}

/**
 * Pick the best logo variant for a given background type.
 * Dark/ford-blue/marsh backgrounds need light logos; light backgrounds need dark logos.
 */
export function getLogoForBg(bdl: BrandDesignLanguage | null | undefined, bgType: BgType): string | null {
  if (!bdl?.logos) return null;
  const logos = bdl.logos;

  if (bgType === 'dark' || bgType === 'ford-blue' || bgType === 'marsh') {
    // Dark bg → use primary_dark (light-colored logo designed FOR dark backgrounds)
    return logos.primary_dark || logos.svg || logos.primary_light || logos.icon || null;
  }
  // Light bg → use primary_light (dark-colored logo designed FOR light backgrounds)
  return logos.primary_light || logos.svg || logos.primary_dark || logos.icon || null;
}

/**
 * Get the brand's primary color for accent use.
 */
export function getBrandAccent(bdl: BrandDesignLanguage | null | undefined): string | null {
  return bdl?.colors?.accent || bdl?.colors?.primary || null;
}

/**
 * CSS color variables for the deck theme.
 */
export const DECK_COLORS = {
  bone: '#f0efe9',
  charcoal: '#1a1a2e',
  marsh: '#4a6741',
  sand: '#c9a96e',
  fordBlue: '#003478',
  muted: '#777',
  border: 'rgba(0,0,0,0.08)',
} as const;

/**
 * Background styles for each slide bg_type.
 */
export function getBgStyles(bgType: BgType): React.CSSProperties {
  switch (bgType) {
    case 'dark':
      return { background: DECK_COLORS.charcoal, color: '#e8e4de' };
    case 'ford-blue':
      return { background: DECK_COLORS.fordBlue, color: '#fff' };
    case 'marsh':
      return { background: DECK_COLORS.marsh, color: '#fff' };
    case 'light':
    default:
      return { background: DECK_COLORS.bone, color: DECK_COLORS.charcoal };
  }
}

/**
 * Text color helpers for slide bg type.
 */
export function getTextColors(bgType: BgType) {
  const isDark = bgType === 'dark' || bgType === 'ford-blue' || bgType === 'marsh';
  return {
    heading: isDark ? '#e8e4de' : DECK_COLORS.charcoal,
    body: isDark ? '#bbb5aa' : '#4a4a4a',
    muted: isDark ? '#888' : DECK_COLORS.muted,
    mark: isDark ? '#555' : DECK_COLORS.muted,
    sectionLabel: bgType === 'ford-blue' ? DECK_COLORS.sand
      : bgType === 'dark' ? DECK_COLORS.fordBlue
      : DECK_COLORS.fordBlue,
    cardBg: isDark ? '#222233' : '#ebe6e0',
    cardBorder: isDark ? 'rgba(255,255,255,0.06)' : DECK_COLORS.border,
    statNum: bgType === 'ford-blue' ? '#fff' : isDark ? '#fff' : DECK_COLORS.fordBlue,
    bulletColor: bgType === 'ford-blue' ? '#fff' : isDark ? DECK_COLORS.sand : DECK_COLORS.fordBlue,
  };
}
