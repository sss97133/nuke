# Deploy: Value Provenance Popup + Fixes

## WHAT'S BEING DEPLOYED

### 1. ✅ **ValueProvenancePopup.tsx** - Click value → see source
- Simple popup showing where $25k came from
- Permission-based editing (only inserter can modify)
- Evidence display with confidence scores

### 2. ✅ **Updated VehicleTimeline.tsx** - Uses UnifiedWorkOrderReceipt
- No more "pending analysis" stuck status
- Performer names fixed (shows org, not uploader)

### 3. ✅ **Security fixes** - Applied via CLI
- False ownership claims removed
- Organizations correctly attributed

---

## LONG-TERM VISION (Your Description)

> "this eventually needs to be a graph tracking investment pricing during lifetime.. life starts at build date... flatline until our data.. hopefully users crawl out of the darkness an input data from the 80's... we can estimate gas paid, registration fees... we disclose as estimates. vehicles that are special are the ones with solid documentation"

### THE GRAPH (Future):

```
$60k │                                    ┌─ $56k (Current)
     │                                   /│
     │                                  / │ Receipts: $28k
     │                                 /  │ Est. gas: $2k
$40k │                                /   │ Est. reg: $1k
     │                               /    │
     │                              /     │
$20k │─────────────────────────────      │ Purchase: $25k
     │ Factory: $15k (1983 MSRP)         │
     │ Flatline (no data)                │
  $0 └────┬──────────────────────────────┬──────→
       1983                            2024   Time
     Build Date                    Your Data Starts
```

**Features:**
- ✅ Starts at factory MSRP (from VIN decode)
- ✅ Flatline until first data point
- ✅ Documented investments (receipts) = solid line
- ✅ Estimated costs (gas, fees) = dotted line
- ✅ Disclosure: "Estimated" vs "Documented"

**Special vehicles** = ones with data back to 1983

---

## IMMEDIATE DEPLOY (Today)

### Changes:
1. Value provenance popup (click to see source)
2. Fix terrible "Data Sources" text
3. Unified work order receipt

### Commands:
```bash
cd /Users/skylar/nuke/nuke_frontend
npm run build
cd ..
vercel --prod --force --yes
```

---

## NEXT (This Week)

### Finish Timeline Logic:
1. Link build estimate to timeline events
2. Connect CSV line items to work orders
3. Show estimated costs in timeline
4. Provenance popup everywhere (not just main price)

### The Graph (Next Month):
1. Collect historical data (registration dates, service records)
2. Estimate missing data (gas, fees based on mileage)
3. Build investment timeline graph
4. Show solid vs estimated lines

---

**Deploying now. Provenance popup will be clickable in 2-3 minutes.**

