# Ralph Wiggum RLM - Extended Dev Loop

**Duration:** 4-8 hours autonomous development
**Mode:** Infrastructure, UI, Data Integrity, Polish

---

## Context

Nuke is a fractional vehicle ownership platform. Core systems built:
- Order matching engine (price-time priority)
- Real-time market data (Supabase Realtime)
- Trading terminal with charts
- Scheduled auctions with committed offers
- Storage vault system
- Risk management / position limits
- SEC compliance workflows (in progress)
- Intuit/QuickBooks integration (in progress)

**Current State:** Backend is solid but UI is "generative-looking" - needs polish and consistency. Some buttons/flows may be wired incorrectly or incomplete.

---

## Priority Rotation

Cycle through these areas, spending ~45-60 min per pass before rotating:

### 1. Infrastructure & Edge Functions

**Check:**
- Edge functions have proper error handling
- RPC functions handle edge cases (nulls, missing records)
- Database constraints are complete
- Indexes exist for common query patterns

**Actions:**
- Review `/supabase/functions/` for TODO comments
- Add missing error handling
- Ensure all functions have CORS headers
- Check for N+1 query patterns

**Key files:**
- `supabase/functions/*/index.ts`
- `supabase/migrations/*.sql`

### 2. UI Consistency Pass

**Check:**
- Consistent spacing (use multiples of 4px: 4, 8, 12, 16, 24, 32, 48)
- Consistent colors (gray-900 backgrounds, gray-700 borders, etc.)
- Typography hierarchy (text-xs, text-sm, text-base, text-lg, text-xl)
- Button styles consistent across app
- Loading states present
- Error states handled

**Actions:**
- Audit components in `/nuke_frontend/src/components/`
- Fix inconsistent padding/margins
- Ensure all interactive elements have hover states
- Add missing loading spinners
- Standardize empty states

**Key files:**
- `nuke_frontend/src/components/**/*.tsx`
- `nuke_frontend/src/index.css` or tailwind config

### 3. Data Integration & Integrity

**Check:**
- Foreign keys are properly set
- Cascades are correct (DELETE CASCADE vs RESTRICT)
- Data flows correctly between tables
- No orphaned records possible
- Timestamps auto-update

**Actions:**
- Run integrity queries to find orphans
- Add missing constraints
- Verify RLS policies don't block legitimate access
- Check that triggers fire correctly

**Integrity queries to run:**
```sql
-- Orphaned holdings (no offering)
SELECT * FROM share_holdings sh
WHERE NOT EXISTS (SELECT 1 FROM vehicle_offerings vo WHERE vo.id = sh.offering_id);

-- Orders without valid users
SELECT * FROM market_orders mo
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = mo.user_id);

-- Trades with missing buyer/seller
SELECT * FROM market_trades mt
WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = mt.buyer_id)
   OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = mt.seller_id);
```

### 4. Button & Flow Audit

**Check:**
- All buttons have onClick handlers
- Forms submit correctly
- Navigation works
- Modals open/close properly
- Confirmations appear for destructive actions

**Actions:**
- Search for `onClick={() => {}}` or missing handlers
- Test form submissions
- Verify toast/notification feedback
- Ensure loading states during async operations

**Search patterns:**
```bash
# Empty handlers
grep -r "onClick={() => {}}" nuke_frontend/src/
grep -r "onClick={() => console.log" nuke_frontend/src/

# TODO in frontend
grep -r "TODO" nuke_frontend/src/
grep -r "FIXME" nuke_frontend/src/
```

### 5. Type Safety & Cleanup

**Check:**
- No `any` types where avoidable
- Interfaces defined for API responses
- Props properly typed
- No unused imports/variables

**Actions:**
- Run TypeScript compiler in strict mode
- Fix type errors
- Remove dead code
- Clean up unused imports

```bash
cd nuke_frontend && npx tsc --noEmit
```

### 6. Documentation & Comments

**Check:**
- Complex functions have JSDoc comments
- Edge functions document their API
- Database functions have COMMENT ON

**Actions:**
- Add missing function documentation
- Update CLAUDE.md if new patterns emerge
- Document any new env vars needed

---

## Checkpoints

Every 2 hours, create a checkpoint:

1. **Git commit** with clear message of what was done
2. **Update this file** with completed items (add ✅)
3. **Note blockers** if any external input needed
4. **Prioritize** remaining work

---

## Do NOT Do

- Don't redesign major UI flows without approval
- Don't change database schema in breaking ways
- Don't remove features
- Don't add new major features (stick to polish/fixes)
- Don't modify auth flows
- Don't touch .env or secrets

---

## Completion Criteria

Session is successful if:
- [ ] At least 10 UI inconsistencies fixed
- [ ] At least 5 edge function improvements
- [ ] Data integrity queries run clean
- [ ] No TypeScript errors in strict mode
- [ ] All obvious broken buttons fixed
- [ ] 2+ git commits with clear messages

---

## Session Log

_Add entries as you work:_

```
[TIMESTAMP] Started session
[TIMESTAMP] Completed: ...
[TIMESTAMP] Found issue: ...
[TIMESTAMP] Blocked on: ...
[TIMESTAMP] Checkpoint commit: ...
```

---

## Quick Commands

```bash
# Start frontend dev
cd /Users/skylar/nuke/nuke_frontend && npm run dev

# Type check
cd /Users/skylar/nuke/nuke_frontend && npx tsc --noEmit

# Deploy edge function
cd /Users/skylar/nuke && supabase functions deploy [name] --no-verify-jwt

# Run coordination brief
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"action\": \"brief\"}"' | jq

# DB stats
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -sS "${VITE_SUPABASE_URL}/functions/v1/db-stats" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"' | jq .
```

---

## Start Command

```
ralph
```

Then paste this context or reference this file.
