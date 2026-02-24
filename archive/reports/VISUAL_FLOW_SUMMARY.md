# Visual Flow Summary - One Page Overview

## 🎯 THE COMPLETE SYSTEM IN 4 FLOWS

---

## **FLOW A: Automatic Value Discovery (Main "Sauce")**

```
📸 USER UPLOADS PHOTOS
    └─> Contains GPS: 35.97271, -114.85527
    └─> Date: Nov 1, 2025
    └─> 6 images of interior work
         │
         ▼
🗺️  GPS AUTO-MATCH
    └─> Searches orgs within 100m
    └─> Finds: Ernies Upholstery (15m away)
    └─> Confidence: 100%
         │
         ▼
🔗 AUTO-LINK EVENT
    └─> UPDATE timeline_events
    └─> SET organization_id = Ernie's
    └─> Trigger creates business_timeline_event
         │
         ▼
🤖 AI ANALYZES IMAGES
    └─> GPT-4o Vision API
    └─> Prompt: "You're expert shop foreman, analyze these 6 photos..."
    └─> Returns JSON with work log
         │
         ▼
📝 WORK LOG CREATED
    ├─> Title: "Interior Upholstery Replacement"
    ├─> Description: Professional summary
    ├─> Work: ["Removed old upholstery", "Installed leather seats", ...]
    ├─> Parts: ["Brown leather", "Diamond stitch", "Door panels"]
    ├─> Labor: 12 hours
    ├─> Quality: 9/10
    └─> Value: +$1,800
         │
         ▼
💰 VALUE CALCULATED
    └─> 260 work orders total
    └─> 158.5h × $125/hr = $19,812
    └─> Recovery rate: 50% = $9,906
    └─> AI impact: $4,300
    └─> Quality premium: $1,125
    └─> GPS premium: $1,250
    └─> TOTAL BOOST: +$16,581
         │
         ▼
📊 DISPLAYED ON 3 PROFILES
    ├─> Vehicle: Shows work history & boosted value
    ├─> Organization: Shows on heatmap & portfolio
    └─> User: Shows contributions & credibility
```

**Time:** Fully automatic, happens in background  
**User Effort:** 0 minutes (just upload photos)  
**Value Created:** $16,000+ for Bronco  

---

## **FLOW B: Work Order Request (Customer → Shop)**

```
📱 CUSTOMER ON MOBILE
    └─> Visits: nuke.ag/org/ernies-upholstery
    └─> Clicks: "Request Work"
         │
         ▼
📝 FORM OPENS
    ├─> Select vehicle: "My 1977 K5"
    ├─> Work needed: "Seat reupholstery"
    ├─> Description: "Torn driver seat..."
    ├─> Urgency: "Normal"
    └─> Contact: Auto-filled from profile
         │
         ▼
📸 TAP "TAKE PHOTOS"
    └─> Camera opens (back camera)
    └─> Take photo of torn seat
    └─> Take photo of damage close-up
    └─> Take photo of whole interior
    └─> Thumbnails appear in form
         │
         ▼
✉️  SUBMIT REQUEST
    └─> Creates work_order record
    └─> Status: "pending"
    └─> Stores 3 photo URLs
    └─> Notifies shop owner
         │
         ▼
🔔 SHOP RECEIVES
    └─> Email notification
    └─> Dashboard shows new request
    └─> Reviews photos
    └─> Sees damage clearly
         │
         ▼
💵 SHOP SENDS QUOTE
    └─> "Can repair for $450"
    └─> "4-hour job"
    └─> "Quality leather available"
    └─> Status → "quoted"
         │
         ▼
✅ CUSTOMER APPROVES
    └─> Clicks "Accept Quote"
    └─> Status → "approved"
    └─> Work scheduled
         │
         ▼
🔧 WORK PERFORMED
    └─> Shop does upholstery
    └─> Takes progress photos
    └─> Photos auto-GPS-link
    └─> AI generates work log
    └─> Vehicle gains $450 value
         │
         ▼
🎊 EVERYONE WINS
    ├─> Customer: Seat fixed, value documented
    ├─> Shop: Portfolio built, quality shown
    └─> Platform: Transaction fee potential
```

---

## **FLOW C: Shop Profile Setup (Owner)**

```
🏪 SHOP OWNER
    └─> Visits own org profile
    └─> Clicks "Claim Ownership"
         │
         ▼
📄 UPLOAD DOCUMENTS
    └─> Business license
    └─> Tax ID
    └─> Insurance certificate
    └─> Status: "pending_verification"
         │
         ▼
✅ VERIFIED BY ADMIN
    └─> isOwner = true
    └─> Owner buttons appear
         │
         ▼
📍 SET GPS LOCATION
    ├─> Click "Set GPS Location"
    ├─> Interactive map opens
    ├─> Drag marker to shop address
    ├─> Lat: 35.97272, Lon: -114.85527
    └─> Save → Enables auto-linking
         │
         ▼
💵 SET LABOR RATE
    ├─> Click "Set Labor Rate"
    ├─> Enter: $125/hr
    └─> Save → Used in estimates
         │
         ▼
📸 UPLOAD SHOP PHOTOS
    ├─> Click "Contribute Data" → Images
    ├─> Upload facility photos
    ├─> EXIF GPS extracted
    ├─> Timeline event created
    └─> Shows on heatmap
         │
         ▼
🔍 AI SCAN IMAGES
    ├─> Click "SCAN" on shop image
    ├─> AI extracts: Tools, equipment, inventory
    └─> Shows in Inventory tab
         │
         ▼
🎯 READY FOR BUSINESS
    └─> GPS set → Auto-links vehicle work
    └─> Rate set → Provides accurate quotes
    └─> Photos set → Professional presence
    └─> Portfolio builds automatically as work happens
```

---

## **FLOW D: Value Impact on Sales**

```
🏷️  VEHICLE LISTING
    └─> "1974 Ford Bronco - $41,500"
    └─> Buyer clicks to view
         │
         ▼
📋 BUYER SEES PROFILE
    ├─> Base specs: Year, make, model, VIN
    ├─> Photos: 243 images
    ├─> Timeline: 260 work orders
    └─> Click timeline event...
         │
         ▼
📖 WORK LOG OPENS
    ┌────────────────────────────────────┐
    │ Nov 1, 2025                        │
    │ Interior Upholstery Replacement    │
    │ Ernies Upholstery ← Clickable      │
    │                                    │
    │ "Complete interior upholstery with │
    │  diamond stitch pattern brown      │
    │  leather. Door panels updated..."  │
    │                                    │
    │ Work Performed:                    │
    │ • Removed old upholstery           │
    │ • Installed custom leather seats   │
    │ • Replaced door panels             │
    │ • Quality fit and finish           │
    │                                    │
    │ Parts:                             │
    │ • Brown leather upholstery         │
    │ • Diamond stitch pattern           │
    │ • Door panels                      │
    │                                    │
    │ 12h labor • $1,800 value           │
    │ Quality: 9/10 ⭐⭐⭐⭐⭐           │
    │ Confidence: 95%                    │
    │                                    │
    │ GPS-Verified at:                   │
    │ 35.97272, -114.85527               │
    │ [View on map]                      │
    │                                    │
    │ [6 photos from this session]       │
    └────────────────────────────────────┘
         │
         ▼
🧮 BUYER CALCULATES
    ├─> Sees 260 work orders
    ├─> All GPS-verified
    ├─> 9/10 average quality
    ├─> $19,812 documented labor
    ├─> Professional shop (not DIY)
    └─> Thinks: "This is legit!"
         │
         ▼
💵 BUYER PAYS PREMIUM
    ├─> Market value: $25,000
    ├─> Documented work: +$16,000
    ├─> Offers: $40,000
    └─> Seller accepts
         │
         ▼
🎊 TRANSACTION COMPLETE
    ├─> Vehicle sold for premium
    ├─> Buyer confident in purchase
    ├─> Shop gets reputation boost
    └─> Platform earns transaction fee
```

---

## 🎯 **4 Stakeholders, 1 Platform**

```
┌─────────────────────────────────────────────────────────┐
│                     THE PLATFORM                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                                                  │  │
│  │   VEHICLE OWNERS        ORGANIZATIONS           │  │
│  │   Upload photos    ←→   Build portfolio         │  │
│  │   Gain value           Get credit for work      │  │
│  │   Sell for premium     Attract customers        │  │
│  │         ↕                    ↕                   │  │
│  │   BUYERS              SERVICE CUSTOMERS          │  │
│  │   See verified work   Request work w/ photos    │  │
│  │   Pay with confidence Get accurate quotes       │  │
│  │                                                  │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  AI Glue: GPS + Vision + Work Logs + Value Calculation │
└─────────────────────────────────────────────────────────┘
```

---

## ✅ **Status: ALL SYSTEMS OPERATIONAL**

**Production URLs:**
- Organizations: `https://nuke.ag/organizations`
- Ernie's Profile: `https://nuke.ag/org/e796ca48-f3af-41b5-be13-5335bb422b41`
- Bronco Profile: `https://nuke.ag/vehicle/79fe1a2b-9099-45b5-92c0-54e7f896089e`

**Latest Deploy:** Bundle `SozPPLVo`

**Data Stats:**
- 273 work orders at Ernie's
- 158.5h documented labor
- $16K+ value boost on Bronco
- 9/10 average quality
- 17 AI-analyzed sessions

**Ready to scale!** 🚀

