/**
 * Feed module barrel export.
 *
 * Usage:
 *   import { useFeedSearchParams, resolveVehiclePrice } from '../feed';
 *   import type { FeedVehicle, ResolvedPrice } from '../feed';
 */

// Types
export type {
  FeedVehicle,
  FeedQueryParams,
  FeedQueryResponse,
  FeedStats,
  FeedSortField,
  FeedViewConfig,
  ResolvedPrice,
  PriceSource,
} from './types/feed';
export { DEFAULT_VIEW_CONFIG } from './types/feed';

// Hooks
export { useFeedSearchParams } from './hooks/useFeedSearchParams';
export type { FeedSearchParamsResult } from './hooks/useFeedSearchParams';
export { useFeedQuery } from './hooks/useFeedQuery';

// Components
export { VehicleCard } from './components/VehicleCard';
export type { VehicleCardProps } from './components/VehicleCard';
export { AuctionClockProvider, useAuctionClock } from './components/AuctionClockProvider';
export { CardShell } from './components/card/CardShell';
export { CardImage } from './components/card/CardImage';
export { CardIdentity } from './components/card/CardIdentity';
export { CardPrice } from './components/card/CardPrice';
export { CardMeta } from './components/card/CardMeta';
export { CardDealScore } from './components/card/CardDealScore';
export { CardSource } from './components/card/CardSource';
export { CardAuctionTimer } from './components/card/CardAuctionTimer';
export { CardActions } from './components/card/CardActions';
export { CardTier } from './components/card/CardTier';
export { CardRankScore } from './components/card/CardRankScore';

// Page & layout components
export { FeedLayout } from './components/FeedLayout';
export { FeedToolbar } from './components/FeedToolbar';
export { FeedFilterSidebar } from './components/FeedFilterSidebar';
export { FeedStatsStrip } from './components/FeedStatsStrip';
export { FeedSkeleton } from './components/FeedSkeleton';
export { FeedEmptyState } from './components/FeedEmptyState';

// API
export { fetchFeed } from './api/feedApi';

// Utils
export { resolveVehiclePrice } from './utils/feedPriceResolution';
export {
  serializeToUrl,
  deserializeFromUrl,
  urlHasFeedParams,
  urlStatesEqual,
} from './utils/feedUrlCodec';
export type { FeedUrlState } from './utils/feedUrlCodec';
export { timeAgo, vehicleTimeLabel } from './utils/timeAgo';
