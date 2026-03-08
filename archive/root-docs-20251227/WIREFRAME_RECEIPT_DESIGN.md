# Receipt Wireframe Design - Reference

## Wireframe Layout

```
┌─────────────────────────────────────────────────────┐
│  ← PREV DAY    10/11/2025    NEXT DAY →            │  ← Date Nav
├─────────────────────────────────────────────────────┤
│  WORK ORDER #8A5985EA      PERFORMED BY             │
│  October 11, 2025          skylar williams          │
├─────────────────────────────────────────────────────┤
│  EVIDENCE SET (5 photos)          ⏳ AI pending     │
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐                   │  ← Photo Grid
│  │img│ │img│ │img│ │img│ │img│                   │
│  └───┘ └───┘ └───┘ └───┘ └───┘                   │
├─────────────────────────────────────────────────────┤
│  WORK PERFORMED                                     │
│  Installed new seats, reupholstered interior       │
├─────────────────────────────────────────────────────┤
│  COST BREAKDOWN                                     │
│  Item                    Qty  Unit    Total        │
│  Front bucket seats       2   $450    $900         │
│  Upholstery fabric        1   $350    $350         │
│  Labor (8 hrs @ $40/hr)   8   $40     $320         │
│  ────────────────────────────────────────────      │
│  TOTAL                                  $1,570     │
├─────────────────────────────────────────────────────┤
│  COMMENTS (2)                                       │
│  ┌──────────────────────────────────────────────┐  │
│  │ [img] skylar • IMAGE • Oct 11, 2:30 PM       │  │
│  │       Seats look great! Color matches        │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │ [img] dave • IMAGE • Oct 11, 3:15 PM         │  │
│  │       Is this original fabric or repro?      │  │
│  └──────────────────────────────────────────────┘  │
│                                                     │
│  [Add a comment or note...        ] [POST]         │
├─────────────────────────────────────────────────────┤
│                         [ESC TO CLOSE]              │
└─────────────────────────────────────────────────────┘
```

## Design Specifications

### Font
- **Family**: Arial, sans-serif (NOT Courier New)
- **Sizes**: 
  - Date nav: 7pt
  - Headers: 8-10pt
  - Body: 9pt
  - Small text: 7pt

### Colors
- Background: #fff (white)
- Border: #000 (2px solid black)
- Header background: #fafafa
- Date nav background: #f5f5f5
- Text: #000 (black)
- Muted text: #666

### Layout
- Max width: 800px
- Border: 2px solid #000
- Sections separated by 2px solid borders
- Date navigation at top with PREV/NEXT buttons
- Evidence set shows photo grid
- Cost breakdown in table format
- ESC TO CLOSE at bottom

## Current Implementation Status

✅ **Implemented:**
- Date navigation (PREV DAY / NEXT DAY)
- Arial font
- Evidence set with photo grid
- Work performed section
- Cost breakdown table format
- ESC TO CLOSE footer

⚠️ **Issue:**
- Green square click opens day popup instead of receipt directly
- **FIXED**: Green squares now open receipt directly

## How to Access

1. **From Timeline Events**: Click any event card → Receipt opens
2. **From Green Squares**: Click green square in calendar → Receipt opens for that day's first event
3. **From Day Popup**: Click event in day popup → Receipt opens

