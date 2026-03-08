# Dev Loop Fix Plan

Generated: 2026-01-25
Target: 4-8 hour autonomous session

---

## Infrastructure Pass

- [x] Audit `place-market-order/index.ts` for edge cases (Loop 1 - fixed auth, fractional shares, FOK/IOC handling)
- [x] Audit `cancel-order/index.ts` error handling (Loop 2 - fixed auth header, JSON parsing, UUID validation, assetType validation, expired status)
- [x] Audit `scheduled-auction-manager/index.ts` error handling (Loop 3 - fixed JSON parsing, added UUID/date validators, validated all request params, null checks on RPC results, 404 handling)
- [x] Audit `market-analytics/index.ts` null handling (Loop 4 - added UUID validation, safeDivide helper, fixed 6 division-by-zero risks, changed .single() to .maybeSingle())
- [x] Check all edge functions have proper CORS headers (Loop 5 - audited 36 without CORS, all are backend-only functions, no action needed)
- [ ] Find and fix any TODO comments in `/supabase/functions/`
- [ ] Verify `match_order_book` RPC handles empty order book
- [ ] Verify `settle_auction` RPC handles no bids case
- [ ] Verify risk limit functions handle new users gracefully

---

## UI Consistency Pass

- [ ] Audit `OrderBook.tsx` - spacing, colors, loading states
- [ ] Audit `TradePanel.tsx` - spacing, colors, loading states
- [ ] Audit `TradeTape.tsx` - spacing, colors, loading states
- [ ] Audit `PriceChart.tsx` - spacing, colors, loading states
- [ ] Audit `MarketDepth.tsx` - spacing, colors, loading states
- [ ] Audit `TradingTerminal.tsx` - spacing, colors, loading states
- [ ] Audit `ScheduledAuction.tsx` - spacing, colors, loading states
- [ ] Audit `CommittedBidStack.tsx` - spacing, colors, loading states
- [ ] Audit `VaultPortfolio.tsx` - spacing, colors, loading states
- [ ] Find components missing loading states
- [ ] Find components missing error states
- [ ] Standardize button styles across trading components
- [ ] Standardize empty state messaging

---

## Data Integrity Pass

- [ ] Run orphaned holdings query
- [ ] Run orphaned orders query
- [ ] Run orphaned trades query
- [ ] Check `scheduled_auctions` foreign keys
- [ ] Check `committed_bids` foreign keys
- [ ] Check `vehicle_storage` foreign keys
- [ ] Check `storage_fees` foreign keys
- [ ] Verify `user_position_limits` created on first trade
- [ ] Verify RLS policies don't block legitimate access

---

## Button & Flow Audit

- [ ] Search for empty onClick handlers in `/src/components/`
- [ ] Fix any found empty handlers
- [ ] Verify TradePanel buy/sell buttons work
- [ ] Verify OrderBook price click works
- [ ] Verify TradingTerminal keyboard shortcuts work
- [ ] Verify auction bid placement flow
- [ ] Verify vault release request flow
- [ ] Add missing confirmation dialogs for destructive actions

---

## Type Safety Pass

- [ ] Run `npx tsc --noEmit` in nuke_frontend
- [ ] Fix any TypeScript errors
- [ ] Replace `any` types with proper interfaces
- [ ] Add missing interface definitions for API responses
- [ ] Remove unused imports

---

## Documentation Pass

- [ ] Add JSDoc to complex functions in hooks
- [ ] Add COMMENT ON to new SQL functions
- [ ] Update CLAUDE.md if new patterns discovered

---

## Discovered Issues

_Add issues found during audit here:_

- [ ]

---

## Completed

_Move completed tasks here with notes:_

