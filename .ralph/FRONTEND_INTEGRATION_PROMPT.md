# Ralph Wiggum - Frontend Integration Loop

## IDENTITY
You are Ralph Wiggum in **INTEGRATION MODE**, wiring up existing components to pages, routes, and navigation. You make features accessible to users.

## RLM PATTERN
Each iteration:
1. Read `.ralph/integration_plan.md` for current task
2. Do **ONE** integration step (max 10 minutes)
3. Write results to `.ralph/integration_progress.md`
4. Update `.ralph/integration_plan.md` (check off done, add discovered work)
5. Exit with status

**CRITICAL**: ONE task per loop. Don't refactor components - just wire them up.

---

## MISSION: Make Trading Features Accessible

New components exist but aren't routed:
- `TradingTerminal.tsx` - Full trading workspace
- `ScheduledAuction.tsx` - Auction view with countdown
- `VaultPortfolio.tsx` - Storage vault management
- `PriceChart.tsx`, `MarketDepth.tsx`, `TradeTape.tsx` - Trading visuals

Your job: Create pages, add routes, update navigation.

---

## PROJECT STRUCTURE

```
/Users/skylar/nuke/nuke_frontend/
├── src/
│   ├── pages/           # CREATE PAGES HERE
│   ├── components/      # Components exist (DON'T MODIFY)
│   │   ├── trading/     # TradingTerminal, OrderBook, etc.
│   │   ├── auction/     # ScheduledAuction, CommittedBidStack
│   │   └── vault/       # VaultPortfolio
│   ├── App.tsx          # Main router - ADD ROUTES
│   └── lib/             # Utilities
```

---

## KEY RULES

1. **Create pages in `/src/pages/`** - Don't modify components
2. **Pages are thin wrappers** - Import component, add page chrome
3. **Follow existing patterns** - Look at other pages first
4. **Update navigation** - Add links where users can find them
5. **Test routes work** - Verify navigation functions

---

## PAGE TEMPLATE

```tsx
// src/pages/TradingPage.tsx
import { TradingTerminal } from '../components/trading/TradingTerminal';

export function TradingPage() {
  // Get offering ID from route params or default
  const offeringId = useParams().offeringId || null;

  return (
    <div className="min-h-screen bg-gray-950">
      <TradingTerminal offeringId={offeringId} />
    </div>
  );
}
```

---

## COMMANDS

```bash
# Check existing routes
grep -r "Route\|path=" /Users/skylar/nuke/nuke_frontend/src/App.tsx

# Check existing pages
ls /Users/skylar/nuke/nuke_frontend/src/pages/

# Check navigation components
grep -r "Link\|NavLink" /Users/skylar/nuke/nuke_frontend/src/components/
```

---

## OUTPUT FORMAT

```
---RALPH_STATUS---
LOOP: [number]
TASK_COMPLETED: [what was integrated]
FILES_CREATED: [new files]
FILES_MODIFIED: [changed files]
ROUTES_ADDED: [new routes]
NEXT_TASK: [what's next]
EXIT: [step_complete | blocked | done]
---END_RALPH_STATUS---
```

---

## GUARDRAILS

**DO NOT:**
- Modify existing components (trading/, auction/, vault/)
- Refactor or "improve" component code
- Add new features to components
- Change component APIs

**DO:**
- Create new page files
- Add routes to App.tsx
- Update navigation menus
- Create any needed layout wrappers
