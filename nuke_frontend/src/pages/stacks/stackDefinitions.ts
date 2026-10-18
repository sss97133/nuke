// Stack A, the auction as an order book (case ledger §13.2, docs/ledger/theory/data-machine-cases.md): registry row SA,
// version 1 (public.stacks, migration 20261007013000_stack_registry.sql, PR #721). The registry and v_stacks are
// service_role only, so until a public reader of them exists this page reads the definition from here; the name,
// question and layer path below are the registry seed's text. `state` is what each layer has today (a reader, part of
// one, or none); the page measures the coverage of the layers that have a reader from live rows on every read.

export type LayerId =
  | 'log' | 'key' | 'dimension' | 'fold' | 'baseline' | 'residual' | 'feature' | 'prediction' | 'outcome';

/** reader: a live reader returns this layer. partial: part of it. missing: nothing returns it; the page names it. */
export type LayerState = 'reader' | 'partial' | 'missing';

export interface StackLayer {
  id: LayerId;
  name: string;
  /** What the layer holds in this stack (the registry path text). */
  holds: string;
  state: LayerState;
  /** The reader this page uses for the layer, or null. */
  reader: string | null;
  /** What does not exist yet, or null when the reader covers the layer. */
  missing: string | null;
}

export interface DemonstrationLot {
  vehicleId: string;
  auctionEventId: string;
  /** When the lot was selected, and the rule and counts that selected it (scripts/data/q.sh, read-only). */
  selectedAt: string;
  rule: string;
  keyedBidsInWindow: number;
  identities: number;
  liveLots: number;
  /** The raw ranking's first lot, excluded by the window guard, with why. */
  excluded: { vehicleId: string; auctionEventId: string; keyedBids: number; outsideWindow: number } | null;
}

export interface StackDefinition {
  stackId: string;
  version: number;
  letter: string;
  name: string;
  question: string;
  route: string;
  layers: StackLayer[];
  demonstration: DemonstrationLot;
}

export const ORDER_BOOK_STACK: StackDefinition = {
  stackId: 'SA',
  version: 1,
  letter: 'A',
  name: 'The auction as an order book',
  question:
    "From a live lot's bid and comment frames, what demand curve does it imply against its cohort, and where will the hammer land?",
  route: '/stacks/order-book',
  layers: [
    {
      id: 'log', name: 'Log', state: 'reader',
      holds: 'Every bid comment is a timed quote: posted time on the source, landing time in the database.',
      reader: 'auction_comments rows keyed to this lot (auction_event_id), with the public vehicle gate',
      missing: null,
    },
    {
      id: 'key', name: 'Key', state: 'reader',
      holds: 'Bid to identity (external_identity_id) and bid to lot (auction_event_id), both keyed 2026-10-06.',
      reader: 'external_identities by key; the lot row keys its seller and winner where they resolve',
      missing: null,
    },
    {
      id: 'dimension', name: 'Dimension', state: 'partial',
      holds: 'Comment stance: bid, reservation price, refusal, question.',
      reader: 'comment kind as the comment builder writes it (amount: bid; seller author: seller response; "?": question)',
      missing: 'Stance from the text fold: a stated price ("I would pay X") as a reservation price, "too rich" as a refusal. No reader classifies comments that way.',
    },
    {
      id: 'fold', name: 'Fold', state: 'reader',
      holds: 'Per lot, at every bid: the implied demand curve (identities that revealed a price at or above P), the price, the time to close.',
      reader: "computed on each read from this lot's log only (one lot, bounded); no stored fold table",
      missing: null,
    },
    {
      id: 'baseline', name: 'Baseline', state: 'partial',
      holds: "The cohort's curve shape at the same minutes to close.",
      reader: "live_lot_temperature: the lot's bid, bids and identities against comparable lots at its current hours to close (live lots only)",
      missing: 'The cohort demand-curve shape per minutes to close. No table or reader returns it; valuation_by_ymm, get_comps_scored and market_index_values hold sale outcomes or daily index values, not curves.',
    },
    {
      id: 'residual', name: 'Residual', state: 'missing',
      holds: "This lot's curve against its cohort's curve at the same minutes to close.",
      reader: null,
      missing: 'Needs the baseline curve. Without it there is nothing to subtract.',
    },
    {
      id: 'feature', name: 'Feature', state: 'missing',
      holds: 'Slope, depth and the gap between the top two revealed prices, per lot as of each minute.',
      reader: null,
      missing: 'No table stores these per lot and as-of minute, and none is replayed for past lots, so they cannot be compared across lots or used point-in-time.',
    },
    {
      id: 'prediction', name: 'Prediction', state: 'missing',
      holds: 'Hammer distribution and P(reserve met), with intervals calibrated on every past lot.',
      reader: null,
      missing: 'No model, no backtest, no calibration. The six blanks of a prediction (moment, population, outcome, form, grading rule, baseline) are not filled.',
    },
    {
      id: 'outcome', name: 'Outcome', state: 'reader',
      holds: 'The hammer: the result joined back to the lot by key and clock.',
      reader: 'auction_events outcome and winning bid for this lot, as of its last source read',
      missing: null,
    },
  ],
  demonstration: {
    vehicleId: '781ac7c0-d279-43b9-b456-4e9432fb175d',
    auctionEventId: '88a000fd-fc51-4d02-a93a-84b159deea7e',
    selectedAt: '2026-10-07T01:22:47Z',
    rule:
      'the live BaT lot with the most bid comments keyed to an identity, counting only comments posted inside its own window (no earlier than 14 days before its scheduled close).',
    keyedBidsInWindow: 31,
    identities: 3,
    liveLots: 1300,
    excluded: {
      vehicleId: '7f61c785-ccb1-4a5c-a4f3-8b17d9fe48da',
      auctionEventId: '9e28752d-fc4a-47be-8e7c-d33027e8a1b8',
      keyedBids: 50,
      outsideWindow: 48,
    },
  },
};

export const STACKS: StackDefinition[] = [ORDER_BOOK_STACK];
