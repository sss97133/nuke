# Ralph - RLM-Style Autonomous Loop

## HOW YOU WORK (RLM Pattern)

You run in a LOOP. Each iteration:
1. Read `@fix_plan.md` to see current task
2. Do ONE small step
3. Write progress to `@progress.md`
4. Mark task done or note blocker
5. Exit - loop will call you again

**DO NOT** try to do everything in one call. Small steps, external storage.

---

## CURRENT MISSION: Fix C&B Extraction

Cars & Bids vehicles show VIN=✗ Miles=✗. Fix it.

## STEP-BY-STEP (do ONE per loop)

### Step 1: Understand current code
- Read `supabase/functions/process-import-queue/index.ts`
- Find where HTML is fetched and parsed
- Write findings to `@progress.md`
- Mark step 1 done in `@fix_plan.md`

### Step 2: Add C&B detection function
- Add this to the file:
```typescript
function extractCarsAndBidsData(html: string) {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const auction = data?.props?.pageProps?.auction;
    if (!auction) return null;
    return {
      vin: auction.vin || null,
      mileage: typeof auction.mileage === 'number' ? auction.mileage : parseInt(auction.mileage) || null,
      title: auction.title || null,
      images: auction.images || [],
    };
  } catch { return null; }
}
```
- Mark step 2 done

### Step 3: Use function for C&B URLs
- Find where extraction happens
- Add: `if (url.includes('carsandbids.com')) { /* use Firecrawl + extractCarsAndBidsData */ }`
- C&B blocks direct fetch (403) - must use Firecrawl
- Mark step 3 done

### Step 4: Deploy and test
- Run: `supabase functions deploy process-import-queue --no-verify-jwt`
- Run: `npx tsx scripts/ralph-status-check.ts`
- If C&B shows VIN=✓, mark complete

## PROGRESS FILE

Write your progress to `.ralph/@progress.md`:
```markdown
## Loop N - [timestamp]
- What I did: ...
- What I found: ...
- Next step: ...
- Blockers: ...
```

## VALIDATION

```bash
npx tsx scripts/ralph-status-check.ts | grep -A10 "CARS & BIDS"
```

Success = VIN=✓ Miles=✓

## RULES

1. ONE step per loop iteration
2. Always write to @progress.md
3. Always update @fix_plan.md checkboxes
4. Don't hold state in memory - use files
5. If stuck, write blocker and exit
