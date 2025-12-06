# Dashboard Simplification Plan

## Current Problems

1. **Confusing Sidebar Categories**
   - "Actions (664)" with sub-items: WRENCH work, LINK assignments, IMAGE photos, DOCUMENT documents
   - "BELL Notifications (7)"
   - "LINK Connected (99)"
   - User has no clue what these do

2. **Notifications Are a "Shit Show"**
   - Multiple notification systems scattered everywhere
   - `user_notifications`, `notifications`, `duplicate_notifications` tables
   - Different notification components in different places
   - Inconsistent behavior

3. **Over-Engineered**
   - Complex category system
   - Terminal logs
   - Command palette
   - Too many features that don't add value

## Solution: Radical Simplification

### Option 1: Remove Dashboard Entirely
- Just redirect to `/vehicles` or home
- Notifications can be handled inline where they matter

### Option 2: Ultra-Simple Dashboard
- Single list of items (no categories)
- Just show: "You have X things that need attention"
- Simple list view
- No sidebar, no categories, no complexity

### Option 3: Remove Notifications System
- Notifications are hard to engineer well
- Better to handle things inline:
  - Work approvals → Show on vehicle profile
  - Vehicle assignments → Show on vehicle profile
  - Everything else → Handle where it happens

## Recommendation

**Remove the complex Dashboard and notifications system.**

Instead:
1. Show pending items inline where they matter (vehicle profiles, etc.)
2. Remove the Dashboard page or make it a simple redirect
3. Remove notification bell/counts from header
4. Handle approvals/assignments directly on relevant pages

## Implementation

1. Simplify Dashboard to just show a simple list or redirect
2. Remove Sidebar component
3. Remove notification bell from header
4. Remove notification center components
5. Handle approvals inline on vehicle profiles

