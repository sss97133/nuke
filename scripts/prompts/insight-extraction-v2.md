# Insight Extraction v2 - Actionable & Packageable

## Core Principle
Every insight must answer: **"What should the owner DO with this information?"**

---

## Output Schema

```json
{
  "insights": [
    {
      "finding": "Power steering rack leaking",
      "type": "concern",
      "specificity": "high",

      "source": {
        "quote": "We called it morning sickness - the rack groaned when cold",
        "commenter": "saab_expert_99",
        "image_hint": "Check image showing engine bay, left side"
      },

      "action": {
        "type": "repair",
        "what": "Replace power steering rack",
        "diy_possible": false,
        "content_angle": "Document the repair process - classic Saab content performs well"
      },

      "value_impact": {
        "if_ignored": "Buyer will negotiate $800-1200 off",
        "if_fixed": "Removes objection, cleaner sale",
        "if_documented": "Repair content + receipt = trust builder"
      }
    },
    {
      "finding": "Numbers matching engine with build sheet",
      "type": "highlight",
      "specificity": "high",

      "source": {
        "quote": "Love that it still has the original engine with matching stamp",
        "commenter": "porsche_registry",
        "image_hint": "Engine stamp photo needed"
      },

      "action": {
        "type": "showcase",
        "what": "Document matching numbers with photography",
        "content_angle": "Close-up video of stamp + build sheet comparison"
      },

      "value_impact": {
        "premium": "+15-25% over non-matching",
        "proof_needed": ["Engine stamp photo", "Build sheet", "Registry verification"],
        "marketing_copy": "Matching numbers verified, build sheet documented"
      }
    }
  ],

  "content_opportunities": [
    {
      "type": "repair_documentary",
      "title": "Fixing the Infamous Saab Morning Sickness",
      "insights_used": ["power_steering_rack"],
      "audience": "Saab enthusiasts, DIY mechanics"
    },
    {
      "type": "showcase_reel",
      "title": "Matching Numbers Deep Dive",
      "insights_used": ["numbers_matching"],
      "audience": "Collectors, registry members"
    }
  ],

  "owner_summary": {
    "total_concerns": 2,
    "total_highlights": 3,
    "estimated_repair_cost": "$800-1200",
    "estimated_value_lift_if_addressed": "$2000-3000",
    "top_content_opportunity": "Document the PS rack repair"
  }
}
```

---

## Prompt Template

```
You are analyzing auction comments to extract ACTIONABLE insights for the vehicle owner.

VEHICLE: {year} {make} {model}
KNOWN ISSUES FOR THIS MODEL: {known_issues}

RULES:
1. Every finding must include a SOURCE QUOTE from the comments
2. Every finding must include an ACTION the owner can take
3. Concerns = repair/address opportunities (content: "watch me fix this")
4. Highlights = showcase opportunities (content: "look at this detail")
5. NO generic fluff ("beautiful car", "great investment")
6. Be SPECIFIC - "rust on rear wheel wells" not "rust issues"
7. Include VALUE IMPACT - what happens if addressed vs ignored

COMMENTS:
{comments}

Return JSON matching the schema above.
```

---

## Specificity Scoring

| Score | Example | Usable? |
|-------|---------|---------|
| HIGH | "Rust bubbling under rear wheel arch trim, driver side" | ✅ |
| MEDIUM | "Some rust on the rear fenders" | ⚠️ |
| LOW | "Rust issues" | ❌ |
| ZERO | "Concerns about condition" | ❌ DELETE |

---

## Content Type Mapping

### Concerns → Repair Content
| Finding | Content Angle |
|---------|---------------|
| Power steering leak | "Fixing the Famous Saab Morning Sickness" |
| Rust on fenders | "Rust Repair Timelapse + Prevention Tips" |
| Carb needs rebuild | "Weber Carb Rebuild - Full Process" |

### Highlights → Showcase Content
| Finding | Content Angle |
|---------|---------------|
| Matching numbers | "Verifying Matching Numbers - What to Look For" |
| Original paint | "50 Years of Original Paint - Preservation Detail" |
| Rare option | "1 of 200: The Story Behind This Option Code" |

---

## Value Impact Framework

### Concerns
```
IF IGNORED:  "Buyer will negotiate $X off or walk"
IF FIXED:    "Clean PPI, no objections, faster sale"
IF DOCUMENTED: "Shows proactive ownership, builds trust"
```

### Highlights
```
PREMIUM:     "+X% over comparable without this feature"
PROOF NEEDED: What documentation/photos prove this
MARKETING:   Copy for listing description
```
