// The kit's input shapes. A page renders these and nothing else. A raw column value has no
// way onto the screen without becoming a Claim, and a number has no way onto the screen
// without its Coverage. These are the web's equivalent of the model objects a platform
// hands you: the compiler, not a document, is what keeps the page honest.
import type { VehicleIdentityToken } from '../utils/vehicleIdentity';

export type Viewer = 'anon' | 'contributor' | 'owner';

/** The five text roles. Their sizes live in kit.css and nowhere else. */
export type Role = 'entity' | 'figure' | 'measure' | 'body' | 'caption' | 'label';

/** Broadcast / sale moment video metadata attached to an auction or listing source. */
export type SaleVideoMoment = {
  url?: string | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
  lotNumber?: string | null;
  auctionName?: string | null;
  searchQuery?: string | null;
  lotUrl?: string | null;
  title?: string | null;
  priceText?: string | null;
  imageUrl?: string | null;
};

/** Where a claim came from: the evidence class, and a pointer at the evidence. */
export type Source = {
  kind: 'listing' | 'owner' | 'image' | 'document' | 'agent' | 'model' | 'legacy';
  url?: string | null;
  id?: string | null;
  method?: string | null;
  label?: string | null;
  logoUrl?: string | null;
  lotNumber?: string | null;
  auctionName?: string | null;
  video?: SaleVideoMoment | null;
};

/** One attributed fact: a value, who said it, when it was observed, how far to trust it (0 to 1). */
export type Claim<T = string | number> = {
  value: T;
  unit?: string | null;
  source: Source;
  observed_at: string | null;
  trust: number;
  qualification?: {
    role?: string | null;
    factory_configuration_status?: string | null;
    current_configuration_status?: string | null;
    limitation?: string | null;
  } | null;
};

/** The denominator every number carries: n of `of` members of `grain`, as of a clock. */
export type Coverage = {
  n: number;
  of: number;
  grain: string;
  as_of: string | null;
};

/** A computed number with its method and coverage. A rank renders only above the floor. */
export type Measure = {
  label: string;
  value: number;
  unit: string;
  method: string;
  coverage: Coverage;
  rank?: { p: number; n: number } | null;
};

/** Fewer measured peers than this and a percentile is not shown. Equal to the stacks' MIN_DISTRIBUTION; a test keeps them equal. */
export const RANK_FLOOR = 5;

export type IdentityTokens = { primary: VehicleIdentityToken[]; differentiators: VehicleIdentityToken[] };

/** The vehicle's newest listing submission, as vehicle_listing_state serves it: a tied viewer gets the stage and clocks,
 *  anyone else only a live or sold listing. Never a price. */
export type ListingState = {
  platform: string; status: string; stage?: string | null; stage_since?: string | null; submitted_at?: string | null;
  activated_at?: string | null; url?: string | null; external_listing_id?: string | null; as_of?: string | null;
  visibility?: 'tied' | 'public';
};

export type GalleryImage = { id: string; url: string; taken_at?: string | null; gate: 'approved' };

/** One line item of a header token, exactly as vehicle_facet_items returns it (docs/market/VEHICLE_HEADER_FORM_RULES.md
 * "Facet items"). The reader decides status, lead and source order; a renderer shows them and folds nothing. */
export type FacetItemStatus = 'established' | 'reading' | 'claim' | 'conflict' | 'missing';
export type FacetItemSource = {
  slug?: string | null; label?: string | null; kind?: string | null; class?: string | null; url?: string | null;
  method?: string | null; observed_at?: string | null; value?: unknown; limitation?: string | null;
  decoded?: Record<string, unknown> | null; witness?: { kind: string; id: string; thumb?: string | null } | null;
};
export type FacetItem = {
  key: string; facet: 'as_built' | 'current' | 'decode' | 'derived'; value: unknown; unit: string | null;
  status: FacetItemStatus; sources: FacetItemSource[]; rule: Record<string, unknown> | null;
  equation: Record<string, unknown> | null; needed: string | null; normalized?: string | null; stated?: string | null;
  lead?: boolean; sides?: Array<{ value: unknown; normalized?: string | null; sources: FacetItemSource[] }>;
  candidates?: Array<Record<string, unknown>>; examined?: Array<Record<string, unknown>>;
};
/** Every token's items, keyed by token (year, make, model, body_style, trim, engine, transmission, drivetrain,
 * location). The profile masthead carries all but location, which is read when its token is opened. */
export type TokenItems = Record<string, FacetItem[]>;

export type Section =
  | { kind: 'masthead'; identity: IdentityTokens; year: number | null; make: string | null; model: string | null; transmissionModel?: string | null; price?: Claim<number> | null; priceLabel?: string | null; identity_marks?: Record<string, unknown>[]; listing?: ListingState | null; token_items?: TokenItems | null }
  | { kind: 'strip'; coverage: Coverage; facets: Array<{ dimension: string; label: string; member: Claim<string> }>; odometer?: Claim<number> | null }
  | { kind: 'measures'; stack: string; title: string; coverage: Coverage; items: Measure[] }
  | { kind: 'timeline'; coverage: Coverage; days: Array<{ day: string; kinds: Record<string, number> }> }
  | { kind: 'table'; title: string; coverage: Coverage; columns: string[]; rows: Claim[][] }
  | { kind: 'gallery'; coverage: Coverage; images: GalleryImage[] };

/** One page, as a document: sections in the order the data supports, for one viewer, at one clock. */
export type ProfileDocument = {
  vehicle_id: string;
  viewer: Viewer;
  read_at: string;
  sections: Section[];
};
