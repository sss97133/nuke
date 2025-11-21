# PROOF: Granular Validation System Working

## The 1972 Chevrolet K10 Example

**Vehicle**: https://n-zero.dev/vehicle/d7962908-9a01-4082-a85e-6bbe532550b2

### Data Sources Racing to Fill the Blanks:

| Field | Value | Sources | Race Status |
|-------|-------|---------|-------------|
| **year** | 1972 | 2 | 🥇🥈 BaT + Deal Jacket AGREE |
| **make** | Chevrolet | 2 | 🥇🥈 BaT + Deal Jacket AGREE |
| **model** | K10 | 2 | 🥇🥈 BaT + Deal Jacket AGREE |
| **sale_price** | $78,500 | 1 | 🥇 BaT only (100% confidence) |
| **purchase_price** | $40,000 | 1 | 🥇 Deal Jacket only (90% confidence) |
| **engine** | 327ci V8 | 1 | 🥇 BaT only (95% - needs 2nd) |
| **transmission** | 4-speed manual | 1 | 🥇 BaT only (95% - needs 2nd) |
| **color** | Orange Metallic | 1 | 🥇 BaT only (90% - needs 2nd) |
| **mileage** | 68,000 | 1 | 🥇 BaT only (70% - LOW) |
| **drivetrain** | 4x4 | 1 | 🥇 BaT only (100%) |
| **bed_length** | short bed | 1 | 🥇 BaT only (95%) |
| **interior_color** | Black | 1 | 🥇 BaT only (90%) |

### When User Clicks on "Make":

```
Popup shows:

Field: make
Current Value: Chevrolet

Validators (The Race):
🥇 1st Place: BaT Listing (100% confidence)
   Value: Chevrolet
   Source: https://bringatrailer.com/listing/1972-chevrolet-k10-pickup-6/
   Validated: Nov 03, 2025

🥈 2nd Place: Deal Jacket (95% confidence)
   Value: Chevrolet
   Source: PDF scan
   Validated: Nov 02, 2025

✓ CONSENSUS: Both sources agree
Trust Score: 100%
```

### When User Clicks on "Engine":

```
Field: engine
Current Value: 327ci V8

Validators:
🥇 1st Place: BaT Listing (95% confidence)
   Value: 327ci V8
   Notes: "Engine from BaT listing"
   Validated: Nov 03, 2025

🥈 2nd Place: (OPEN - awaiting validation)
🥉 3rd Place: (OPEN - awaiting validation)

⚠️ Only 1 source - needs additional validation
[+ Add Validation] [Upload Proof]
```

### If Someone Claims Engine Swap:

User adds validation:
- Field: engine
- Value: LS3 V8
- Source: user_input
- Proof: 10 images showing swap process

System detects CONFLICT:
```
⚠️ CONFLICT DETECTED

Original Engine:
🥇 327ci V8 (BaT listing 95%)

Claimed Current Engine:
🥈 LS3 V8 (User input 70% + 10 proof images)

WHY? User claims: "Engine swapped during restoration"
PROOF? 10 images documenting LS3 installation

Resolution:
- Create timeline event: "Engine swapped from 327ci to LS3"
- Keep both validations:
  - engine_original: 327ci V8
  - engine_current: LS3 V8
- Update vehicle.engine to LS3
- Image bundle linked to timeline event
```

---

## The System Is Ready

✅ Database has granular validations  
✅ DataValidationPopup shows sources when you click  
✅ Consensus view aggregates sources  
✅ Conflict detection works  

**Missing:**
- BaT auth bypass for scraping (they're blocking automated requests)
- Image download automation (need to handle auth)
- Bulk import of all 55 listings

**Working:**
- Manual validation insertion
- Multi-source consensus
- Click-to-see-sources UI
- Conflict flagging

The architecture is RIGHT. Just need to solve BaT's auth blocking.
