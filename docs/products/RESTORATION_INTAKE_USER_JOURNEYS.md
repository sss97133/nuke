# Restoration Intake: User Journeys

**Product**: Telegram-based photo intake for restoration companies
**Target Users**: Small restoration shops (mom & pop), their technicians

---

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   BOSS                    TECHNICIAN                  SYSTEM    │
│   ────                    ──────────                  ──────    │
│                                                                 │
│   1. Signs up             4. Gets invite code                   │
│   2. Claims business      5. Opens Telegram                     │
│   3. Generates invite     6. Joins with code                    │
│        code               7. Sets vehicle                       │
│                           8. Sends photos ──────────► AI classifies
│                                                        │        │
│   9. Views dashboard ◄─────────────────────────────────┘        │
│   10. Pulls via API                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Journey 1: Business Owner (The Boss)

### Day 1: Discovery & Signup

**Persona**: Mike, owns a 3-person restoration shop in Phoenix. Uses QuickBooks, has an Instagram presence, no custom software.

**Entry Point**: Hears about Nuke from a forum, friend, or sees an ad.

**Step 1: Visit landing page**
- Sees: "Stop texting photos to yourself. Let your guys Telegram you, we organize everything."
- Key message: Zero change to how techs work (they already send photos)
- CTA: "Start Free Trial"

**Step 2: Create account**
- Email + password (or Google/Apple SSO)
- No credit card required initially
- ❓ QUESTION: Do we want phone number verification here?

**Step 3: Claim or create business**
- Search: "Do we already know your shop?"
  - If found in our database → claim it (verification flow)
  - If not found → create new business profile
- Minimum info needed:
  - Business name
  - City/State
  - Owner phone number (for SMS notifications)

**Step 4: Generate first invite code**
- UI shows: "Invite your first technician"
- Generates code: `ABC12345`
- Instructions shown:
  ```
  Tell your tech:
  1. Download Telegram
  2. Search for @Nukeproof_bot
  3. Send: /start ABC12345
  ```
- Option to copy/share via SMS or WhatsApp

### Day 1-7: Onboarding Techs

**Step 5: Track invites**
- Dashboard shows:
  - Pending invites (codes generated but not used)
  - Active technicians (joined)
  - Last activity per tech

**Step 6: Add vehicles to the shop**
- For each vehicle being worked on:
  - Add by VIN (auto-populates year/make/model)
  - Or manual entry
- Each vehicle gets a QR code or "quick code" for techs
- ❓ DECISION: Do techs need to manually set vehicle, or can we auto-detect?

### Ongoing: Daily Operations

**Step 7: View incoming work**
- Dashboard shows submissions grouped by:
  - Vehicle (most important)
  - Technician
  - Date
  - Work type (body work, paint, mechanical, etc.)

**Step 8: Export/Integrate**
- Download photos for customer updates
- Export work log to CSV
- API access for custom integration
- ❓ FUTURE: QuickBooks integration for time tracking?

### Edge Cases for Boss

| Scenario | Current Handling | Needed |
|----------|-----------------|--------|
| Tech sends photo but wrong vehicle | Shows as "unassigned" | Notification to boss, manual assign UI |
| Multiple businesses under one owner | Not supported | Multi-business dashboard |
| Employee leaves | Revoke access manually | Deactivation flow |
| Boss wants to see real-time | Must refresh | WebSocket/push notifications |
| Boss on mobile | Responsive web | Consider native app? |

---

## Journey 2: Technician (The Worker)

### Day 1: Onboarding

**Persona**: Carlos, 28, restoration tech. Uses phone for photos, sends via text/WhatsApp to boss. Not tech-savvy.

**Critical Constraint**: Must be DEAD SIMPLE. No app download beyond Telegram.

**Step 1: Receive invite**
- Boss texts/tells: "Download Telegram, search Nukeproof_bot, send /start ABC12345"
- Alternative: Boss shares a deep link that opens Telegram directly

**Step 2: Open Telegram**
- If already has Telegram: search "Nukeproof_bot"
- If new to Telegram: Download, create account, then search

**Step 3: Send join command**
```
Carlos: /start ABC12345

Bot: Welcome to Mike's Restoration Shop!

You're now connected. Here's how to log work:

1. Send /vehicle VIN - Set which vehicle you're working on
2. Take photos and send them here
3. Send /done when finished with that vehicle

That's it! Start by setting a vehicle.
```

**Step 4: Set active vehicle**
```
Carlos: /vehicle WBA3A5C51CF123456

Bot: Active vehicle set: 2015 BMW M3

Any photos you send will be logged to this vehicle.
Send /done when you switch to a different car.
```

**Alternative - VIN photo**:
```
Carlos: [sends photo of VIN plate]

Bot: Got it! Active vehicle set: 2015 BMW M3
     VIN: WBA3A5C51CF123456
```

### Daily Workflow

**Step 5: Send work photos**
```
Carlos: [sends photo of sanding work]
        "Sanding the rocker panel"

Bot: Logged for Mike's Restoration Shop

     2015 BMW M3
     body work - Sanding rocker panel area

     Send more photos or /done when finished.
```

**Step 6: Multiple photos**
```
Carlos: [sends 5 photos]

Bot: Got 5 photos for 2015 BMW M3

     Logged: body work (3), paint prep (2)

     Total photos today: 12
```

**Step 7: End of day**
```
Carlos: /done

Bot: Active vehicle cleared.

     Today's stats:
     - 12 photos logged
     - 2 vehicles worked on

     Great work! Send /vehicle VIN when you start tomorrow.
```

### Edge Cases for Technician

| Scenario | Current Handling | What Happens |
|----------|-----------------|--------------|
| Sends photo without setting vehicle | Asked to set vehicle | "No active vehicle. Send /vehicle VIN first" |
| Wrong VIN | Error message | "VIN not found. Check the number and try again." |
| Forgets which vehicle is active | /status command | Shows current vehicle, shop, today's count |
| Boss revokes access | Silent fail? | "Your access has been revoked. Contact your manager." |
| Bad cell service | Photo fails to send | Telegram handles retry automatically |
| Non-photo message | Ignored or clarified | "Send photos or commands. Need help? /help" |
| Multiple shops (moonlighting) | Not supported yet | Would need to select which shop |

### Technician Commands Reference

| Command | Description |
|---------|-------------|
| `/start CODE` | Join a shop using invite code |
| `/vehicle VIN` | Set active vehicle by VIN |
| `/status` | Show current shop, vehicle, today's count |
| `/done` | Clear active vehicle |
| `/help` | Show all commands |

---

## Journey 3: Data Consumer (API Integration)

### Persona: A shop using JobBoss or custom software wants work photos automatically

**Step 1: Get API key**
- Boss goes to Settings → API Keys
- Creates key with name "JobBoss Integration"
- Copies key (shown only once)

**Step 2: Configure polling**
```bash
# Every 15 minutes, pull new submissions
curl "https://api.nuke.dev/v1/business-data/submissions?since=2026-02-05T00:00:00Z" \
  -H "X-API-Key: nk_live_xxx"
```

**Step 3: Process submissions**
```json
{
  "data": [
    {
      "id": "sub_abc123",
      "received_at": "2026-02-05T10:30:00Z",
      "technician": { "name": "Carlos", "id": "tech_xyz" },
      "vehicle": { "vin": "WBA3A5C51CF123456", "year": 2015, "make": "BMW", "model": "M3" },
      "work_type": "body_work",
      "description": "Sanding rocker panel area",
      "photo_urls": ["https://storage.nuke.dev/photos/...jpg"],
      "confidence": 0.92
    }
  ]
}
```

**Step 4: Match to their work order**
- Look up vehicle by VIN in their system
- Attach photos to work order
- Log technician time

### Webhook Alternative (Future)

```json
POST https://customer-system.com/webhooks/nuke
{
  "event": "submission.created",
  "data": { ... }
}
```

---

## Error States & Recovery

### For Technicians

| Error | Message | Recovery |
|-------|---------|----------|
| Invalid invite code | "Invalid or expired code. Ask your manager for a new one." | Boss generates new code |
| VIN not found | "Couldn't find that VIN. Check the number or try a photo of the VIN plate." | Send VIN photo instead |
| Not connected to shop | "You're not connected to a shop. Use /start CODE to join." | Get code from boss |
| Rate limited | "Too many messages. Wait a minute and try again." | Wait 60 seconds |
| AI couldn't classify | "Couldn't identify the work type. What are you working on?" | Tech replies with context |

### For Bosses

| Error | Message | Recovery |
|-------|---------|----------|
| No API key | "Create an API key to access data programmatically." | Go to Settings → API Keys |
| Invalid API key | HTTP 401 "Invalid authentication" | Check key, regenerate if needed |
| Rate limited | HTTP 429 "Rate limit exceeded" | Wait for reset (hourly) |
| No business set up | "Complete your business profile to get started." | Finish onboarding |

---

## Metrics to Track

### Success Metrics (Are We Working?)

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time from invite to first photo | < 10 minutes | Track timestamps |
| Photos per technician per day | > 10 | Database aggregation |
| Photo classification accuracy | > 85% | Sample review + corrections |
| API latency p95 | < 500ms | Monitoring |
| Telegram bot uptime | > 99.9% | Health checks |

### Business Metrics (Are We Growing?)

| Metric | Measurement |
|--------|-------------|
| Businesses signed up | Count unique business_id |
| Businesses with active techs | Has submission in last 7 days |
| Churn rate | Businesses with no activity in 30 days |
| Photos processed | Total submissions |
| API calls | Usage logs |

### Warning Signs

- Tech sends same photo multiple times → Bot not confirming receipt
- No photos for 3+ days → Tech may have stopped using it
- High "unassigned" rate → Vehicle setup is confusing
- Low confidence scores → AI needs improvement
- Boss never views dashboard → Delivering no value

---

## Questions to Resolve

### Product Questions

1. **Pricing**: Free tier? Per-seat? Per-photo?
2. **Vehicle auto-detect**: Can we use YONO to identify vehicle from photo instead of manual /vehicle?
3. **Multi-shop**: Should techs be able to work for multiple shops?
4. **Time tracking**: Should we track work sessions (start/stop)?
5. **Push notifications**: Does boss get SMS/push when photos arrive?

### Technical Questions

1. **Photo storage**: How long do we keep full-res photos?
2. **Privacy**: Does tech consent to location/timestamp metadata?
3. **Offline**: What happens when tech has no signal?
4. **Backup**: Can we also accept SMS for shops without Telegram?

### Go-to-Market Questions

1. **First customers**: Who are our 3 beta shops?
2. **Support**: Who handles tech support for onboarding?
3. **Training**: Do we need video tutorials?
4. **Competitors**: Who else does this? What's our advantage?

---

## Next Steps

1. [ ] Build business onboarding UI (claim/create shop)
2. [ ] Build invite code generation UI
3. [ ] Build technician dashboard (view submissions)
4. [ ] User test with 1 real shop
5. [ ] Iterate based on feedback
6. [ ] Pricing model decision
7. [ ] Marketing page
8. [ ] Launch beta
