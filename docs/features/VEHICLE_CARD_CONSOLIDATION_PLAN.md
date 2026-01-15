# Vehicle Card Consolidation & Enhancement Plan

## Current State

Multiple vehicle card components exist across the site:
- `VehicleCardDense` - Main homepage card (3 view modes: list/grid/gallery)
- `GarageVehicleCard` - User garage with metrics/relationships
- `ShopVehicleCard` - Profile/shop view
- `QuickVehicleCard` - Curation mode with validation actions
- `VehicleDiscoveryCard` - Discovery with status badges
- `EnhancedVehicleCard` - Technical view

## Strategy: Feature Props System

Instead of consolidating into one card, we're adding a **feature visibility props system** to `VehicleCardDense` that allows different pages to show contextually relevant information while maintaining design consistency.

## New Props Added to VehicleCardDense

### Feature Visibility Props
- `showFollowButton?: boolean` - Show follow/bookmark button
- `showRelationshipBadge?: boolean` - Show relationship type badge
- `relationshipType?: 'owned' | 'contributing' | 'interested' | ...` - Relationship to display
- `showMetrics?: boolean` - Show image count, event count, etc.
- `showStatusBadges?: boolean` - Show discovery status, verification badges

### Responsive Sizing Props
- `responsive?: boolean` - Auto-adjust based on container width
- `minCardWidth?: number` - Minimum card width (default: 200px)
- `maxCardWidth?: number` - Maximum card width (default: 400px)

## Implementation Plan

### Phase 1: Props System ✅
- [x] Add feature visibility props to interface
- [ ] Implement responsive sizing logic
- [ ] Add follow button component
- [ ] Add relationship badge display
- [ ] Add metrics display

### Phase 2: Follow/Bookmark System
- [ ] Create `useVehicleFollow` hook
- [ ] Integrate with `user_subscriptions` table
- [ ] Add follow button to cards
- [ ] Create "My Followed Vehicles" page/view

### Phase 3: User-Vehicle Tracking
- [ ] Enhance `discovered_vehicles` tracking
- [ ] Create tracking service for user-vehicle interactions
- [ ] Add "Recently Viewed" functionality
- [ ] Add "Vehicles You Might Like" based on tracking

### Phase 4: Responsive Grid Logic
- [ ] Implement container query-based sizing
- [ ] Optimize grid layouts for different screen sizes
- [ ] Add breakpoint-based feature visibility

## Design Principles

1. **Contextual Relevance** - Show data most relevant to the user's current activity
2. **Design Consistency** - Use similar visual language across all cards
3. **Flexibility** - Allow pages to customize what's shown without creating new components
4. **Performance** - Don't load unnecessary data/features per card

## Migration Strategy

Pages can gradually adopt the new props:
1. Start with new pages/features
2. Migrate existing pages one at a time
3. Keep old components until migration complete
4. Remove old components once all pages migrated

## User-Vehicle Tracking Vision

The goal is to help users stay in contact with vehicles they care about:

1. **Explicit Tracking**
   - Follow/bookmark button on cards
   - Watchlist system (already exists)
   - Saved searches

2. **Implicit Tracking**
   - View history
   - Time spent on vehicle pages
   - Interaction patterns (clicks, shares, etc.)

3. **Surfacing**
   - "Vehicles You're Following" dashboard
   - "Recently Viewed"
   - "Vehicles You Might Like"
   - Notifications for followed vehicles

## Agentic Testing Vision

User mentioned wanting bots to use the site to find bugs. This could involve:
- Automated user journeys
- Edge case discovery
- Performance testing
- Accessibility testing

Would require:
- Agentic framework (LLM-based agents)
- Test scenario definitions
- Bug reporting system
- Repair request workflow
