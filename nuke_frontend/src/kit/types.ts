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

export type GalleryImage = { id: string; url: string; taken_at?: string | null; gate: 'approved' };

export type Section =
  | { kind: 'masthead'; identity: IdentityTokens; year: number | null; make: string | null; model: string | null; transmissionModel?: string | null; price?: Claim<number> | null; priceLabel?: string | null; identity_marks?: Record<string, unknown>[] }
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
