# Email Alert Pipeline Setup

**Time: ~15 minutes. Then it runs forever for free.**

## How It Works

```
Sites send alert emails → Gmail inbox → Apps Script (every 5 min) → Edge function → import_queue → extraction pipeline
```

You never touch the inbox. Listings appear in the queue automatically.

---

## Step 1: Create Gmail Account (~2 min)

Create a new Gmail: `nuke.vehicle.alerts@gmail.com` (or whatever you want).

> Use a fresh account so the inbox only has alert emails.

---

## Step 2: Subscribe to Alerts (~10 min)

Log into each site and create saved searches with your criteria (pre-1991, etc.):

| Site | Alert Setup URL | Notes |
|------|----------------|-------|
| **KSL** | ksl.com/auto → search → "Save Search" | Set to email frequency: instant |
| **Craigslist** | craigslist.org → search → "save search" | Uses the alerts Gmail address |
| **BaT** | bringatrailer.com → Account Settings → Notifications | Daily digest or instant |
| **Hemmings** | hemmings.com → search → save | Email alerts for new matches |
| **eBay Motors** | ebay.com → search → "Save this search" | Toggle email notifications on |
| **Cars.com** | cars.com → search → "Save Search" | Instant or daily |
| **AutoTrader** | autotrader.com → search → "Save Search" | Email me new results |
| **Hagerty** | hagerty.com/marketplace → search → save | Already set up via hagerty-email-parser |
| **CarGurus** | cargurus.com → search → "Email me price drops" | |
| **ClassicCars.com** | classiccars.com → search → save | |
| **PCAR Market** | pcarmarket.com → account → notifications | |
| **Cars & Bids** | carsandbids.com → account → notifications | |

---

## Step 3: Set Up Apps Script (~3 min)

1. **Log into the alerts Gmail** in your browser
2. Go to [script.google.com](https://script.google.com)
3. Click **New Project**, name it "Nuke Alert Processor"
4. Delete the default code and paste the contents of `gmail-apps-script.js`
5. Click **Run** → **processAlertEmails**
6. Grant permissions when prompted (it needs to read your Gmail)
7. Click the **clock icon** (Triggers) on the left sidebar
8. Click **+ Add Trigger**:
   - Function: `processAlertEmails`
   - Deployment: Head
   - Event source: **Time-driven**
   - Type: **Minutes timer**
   - Interval: **Every 5 minutes**
9. Click **Save**

Done. It will check the inbox every 5 minutes forever.

---

## Monitoring

### Check processed emails
```sql
SELECT source_slug, count(*), max(created_at) as last_seen
FROM alert_email_log
GROUP BY source_slug
ORDER BY last_seen DESC;
```

### Check queued listings
```sql
SELECT raw_data->>'alert_source' as source, status, count(*)
FROM import_queue
WHERE raw_data->>'ingested_via' = 'email_alert'
GROUP BY 1, 2
ORDER BY 1, 2;
```

### Apps Script logs
Go to [script.google.com](https://script.google.com) → your project → Executions (left sidebar)

---

## Troubleshooting

- **No emails arriving?** Check spam folder. Add alert senders to contacts.
- **URLs not extracted?** Check `alert_email_log` for `status = 'no_urls'`. The `raw_snippet` column shows what the function saw.
- **Too many junk URLs?** Edit the `isJunkUrl()` function in the edge function.
- **Want to reprocess?** Run `reprocessEmails()` in Apps Script.
