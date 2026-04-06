/**
 * Deck content type definitions.
 * Each slide template has a typed content schema stored as JSONB in deck_slides.content.
 * The `html` field is legacy (v2 raw HTML) and ignored by template rendering.
 */

import type { OrgBrand } from './useDeckData';

/* ── Shared primitives ── */

export interface DeckImage {
  url: string;
  caption?: string;
  size?: 'half' | 'large';
}

export interface DeckStat {
  num: string;
  label: string;
  source?: string;
}

export interface DeckCard {
  title: string;
  body: string;
  bg?: string;           // 'ford-blue' or color code → maps to dk-card--brand
  size?: 'large';
  accent?: string;       // top-border accent color
  cost?: string;         // cost line (AskSlide)
  entity?: string;       // org slug for logo
  role?: string;         // role label (PartnersSlide)
  multi_logos?: string[]; // multiple org slugs for composite logo bar
  table_rows?: { label: string; value: string }[];
}

export interface DeckQuote {
  text: string;
  attribution: string;
  avatar?: string;
}

export interface DeckColumn {
  title: string;
  subtitle?: string;
  items?: string[];
  footer?: string;
  calendar?: { month: string; event: string }[];
  table_rows?: { brand: string; fleet: string; color?: string }[];
}

export interface HotelTableRow {
  entity: string;
  fleet: string;
}


/* ── Per-template content schemas ── */

export interface CoverContent {
  title: string;
  subtitle: string;
  prepared_for: string;
  hero_image: string;
  hero_opacity: number;
  logos: string[];          // org slugs resolved at render
  confidential: boolean;
}

export interface ThesisContent {
  section_label: string;
  title: string;            // may contain <strong> tags
  body: string[];
  callout: {
    title: string;
    body: string[];
    bg?: string;            // 'ford-blue' → dk-card--brand
  };
  hero_image?: string;
  hero_opacity?: number;
}

export interface OpportunityContent {
  section_label: string;
  title: string;
  body: string[];
  cards: DeckCard[];
  images?: DeckImage[];
  footer?: string;
  sources?: string[];
}

export interface ComparisonContent {
  section_label: string;
  title: string;
  columns?: DeckColumn[];
  body?: string[];
  items?: string[];         // competitive items list
  cards?: DeckCard[];
  footer?: string;
  hero_image?: string;
  hero_caption?: string;
  hotel_table?: HotelTableRow[];
  hotel_footer?: string;
  sources?: string[];
}

export interface ProofContent {
  section_label: string;
  title: string;
  body: string[];
  images: DeckImage[];
  quote?: DeckQuote;
  cards: DeckCard[];
  sources?: string[];
}

export interface ProductContent {
  section_label: string;
  title: string;
  body: string[];
  quote?: DeckQuote;
  images: DeckImage[];
  footer?: string;
  sources?: string[];
}

export interface StatsContent {
  section_label: string;
  title: string;
  stats: DeckStat[];
  body: string[];
  hero_image?: string;
  hero_opacity?: number;
  sources?: string[];
}

export interface PartnersContent {
  section_label: string;
  title: string;
  partner_cards: DeckCard[];
  footer?: string;
  sources?: string[];
}

export interface ContentSlideContent {
  section_label: string;
  title: string;
  columns: DeckColumn[];
  sources?: string[];
}

export interface AskContent {
  section_label: string;
  title: string;
  cards: DeckCard[];
  footer?: string;
  benchmarks?: string;
  sources?: string[];
}

export interface GalleryContent {
  section_label?: string;
  images: DeckImage[];
  credits?: string;
  sources?: string[];
}

export interface CloseContent {
  title: string;
  body: string[];
  logos: string[];
  next_step?: string;
  confidential?: string;
}

export interface DividerContent {
  section_label: string;
  title: string;
  number?: string;
}

/** Union of all slide content types */
export type SlideContent =
  | CoverContent
  | ThesisContent
  | OpportunityContent
  | ComparisonContent
  | ProofContent
  | ProductContent
  | StatsContent
  | PartnersContent
  | ContentSlideContent
  | AskContent
  | GalleryContent
  | CloseContent
  | DividerContent;

/** Deck manifest (stored in decks table) */
export interface DeckManifest {
  id: string;
  title: string;
  brand_slug?: string;
  palette_mode: 'dark' | 'light';
  voice: string;
  status: 'draft' | 'review' | 'final';
  created_at: string;
  updated_at: string;
}

/** Slide type string literal union */
export type SlideType =
  | 'cover'
  | 'thesis'
  | 'opportunity'
  | 'comparison'
  | 'landscape'   // alias for comparison
  | 'precedent'   // alias for comparison
  | 'competitive' // alias for comparison
  | 'proof'
  | 'product'
  | 'stats'
  | 'island'      // alias for stats
  | 'partners'
  | 'content'
  | 'ask'
  | 'gallery'
  | 'close'
  | 'divider'
  | 'value';       // alias for opportunity

/** Background type for slides */
export type BgType = 'light' | 'dark' | 'brand' | 'accent' | 'ford-blue' | 'marsh';

/** Map legacy bg_type values to new dk-* class names */
export function bgTypeToClass(bg: BgType | string): string {
  switch (bg) {
    case 'dark': return 'dk-dark';
    case 'ford-blue':
    case 'brand': return 'dk-brand';
    case 'marsh':
    case 'accent': return 'dk-accent';
    case 'light':
    default: return 'dk-light';
  }
}

/** Props shared by all slide template components */
export interface SlideTemplateProps {
  content: Record<string, any>;
  bgType: BgType | string;
  slideIndex: number;
  orgs: Map<string, OrgBrand>;
  canEdit?: boolean;
}
