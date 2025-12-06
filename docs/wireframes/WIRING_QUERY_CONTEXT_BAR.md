# Wiring Query Context Bar - Wireframe

## Overview

A context bar component (similar to "IMG GO") that allows users to query wiring needs in natural language. The system understands the implications of queries, especially when users are mid-project and researching electrical needs.

---

## Component Location

**Primary Location:** Vehicle Profile Page
- Positioned above or within the Parts Quote Generator section
- Always visible when viewing a vehicle profile
- Context-aware based on project status

---

## Visual Design

### Context Bar (Default State)

```
┌─────────────────────────────────────────────────────────────┐
│ [What wiring do you need for this build?] [QUOTE]           │
└─────────────────────────────────────────────────────────────┘
```

**Styling:**
- Same style as IMG GO bar
- `display: flex; align-items: center; gap: 4px;`
- `background: var(--white); border: 2px solid var(--border);`
- `padding: 4px 6px; height: 28px;`
- Input field: flex: 1, transparent background
- QUOTE button: `button-win95` style, disabled when empty

### Context Bar (Processing State)

```
┌─────────────────────────────────────────────────────────────┐
│ [What wiring do you need for this build?] [...]            │
└─────────────────────────────────────────────────────────────┘
```

- Input disabled
- Button shows "..." while processing

### Context Bar (With Results)

```
┌─────────────────────────────────────────────────────────────┐
│ [What wiring do you need for this build?] [QUOTE]           │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Recommendations:                                            │
│ • MCM112 Plug-In ECU Kit                                    │
│ • DTM Connectors (ProWire)                                  │
│ • Wiring Harness Components                                 │
│                                                              │
│ Quote Summary:                                              │
│ Parts: $2,267.00                                            │
│ Labor: $2,250.00                                            │
│ Total: $4,517.00                                            │
│                                                              │
│ Next: Contact Motec dealer for ECU pricing                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Smart Placeholders

### Mid-Project Detection

The system detects if user is mid-project by checking:
- Recent timeline events (last 30 days)
- Recent images (last 30 days)

### Placeholder Text

**Mid-Project:**
```
"What wiring do you need for this build?"
```

**New Project:**
```
"I need a motec wiring harness for my vehicle..."
```

---

## Example Queries

### Natural Language Queries

1. **"I need a motec wiring harness for my vehicle"**
   - System understands: Motec ECU + wiring components needed
   - Context: User is researching electrical system
   - Action: Generate quote with Motec + ProWire products

2. **"What wiring do I need for this build?"**
   - System understands: User wants recommendations
   - Context: Mid-project, researching needs
   - Action: Analyze vehicle, recommend wiring system

3. **"Get me a quote for motec ECU and wiring"**
   - System understands: Direct quote request
   - Context: Ready to purchase
   - Action: Generate complete quote

4. **"I need sensors for my motec system"**
   - System understands: User has Motec, needs sensors
   - Context: Expanding existing system
   - Action: Recommend compatible sensors

---

## Integration Points

### Vehicle Profile Page

```
┌─────────────────────────────────────────────────────────────┐
│ Vehicle Hero Image                                          │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Timeline Section                                            │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Pricing & Analysis                                          │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ ⚡ WIRING QUERY                                              │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [What wiring do you need for this build?] [QUOTE]       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ Parts Quote Generator                                        │
│ (Shows quote results here)                                  │
└─────────────────────────────────────────────────────────────┘
```

### Context-Aware Suggestions

When user is mid-project:
- System analyzes timeline events
- Detects electrical work in progress
- Suggests relevant wiring components
- Shows quote based on current build stage

---

## User Flow

### Flow 1: Natural Language Query

```
1. User types: "I need a motec wiring harness for my vehicle"
2. System parses query:
   - Extracts: Motec ECU, wiring components
   - Identifies vehicle context
   - Determines intent: Quote
3. System queries catalog:
   - Motec products (ECUs, software)
   - ProWire products (connectors, wire)
4. System generates recommendations:
   - MCM112 ECU Kit (recommended)
   - Wiring components
   - System description
5. System generates quote:
   - Parts subtotal
   - Labor estimate
   - Grand total
6. System displays results in context bar
```

### Flow 2: Mid-Project Detection

```
1. User views vehicle profile
2. System checks:
   - Recent timeline events? ✓
   - Recent images? ✓
3. System detects: Mid-project
4. Context bar shows: "What wiring do you need for this build?"
5. User queries: "What do I need?"
6. System analyzes:
   - Current build stage
   - Existing components
   - Missing components
7. System recommends:
   - Next steps
   - Required parts
   - Quote
```

---

## Technical Implementation

### Component Props

```typescript
interface WiringQueryContextBarProps {
  vehicleId: string
  vehicleInfo?: {
    year?: number
    make?: string
    model?: string
  }
  onQuoteGenerated?: (quote: any) => void
  className?: string
}
```

### API Integration

**Function:** `query-wiring-needs`

**Request:**
```json
{
  "query": "I need a motec wiring harness for my vehicle",
  "vehicle_id": "uuid",
  "vehicle_year": 1977,
  "vehicle_make": "Chevrolet",
  "vehicle_model": "Blazer"
}
```

**Response:**
```json
{
  "query_parsed": {
    "vehicle": { "year": 1977, "make": "Chevrolet", "model": "Blazer" },
    "needs": { "motec_ecu": true, "wiring_components": true },
    "intent": "quote"
  },
  "recommendations": [
    { "part_number": "MCM112", "name": "MCM112 Plug-In ECU Kit", "required": true }
  ],
  "quote": {
    "parts": [...],
    "pricing": {
      "parts_subtotal": 2267.00,
      "labor_total": 2250.00,
      "grand_total": 4517.00
    }
  },
  "next_steps": "Contact Motec dealer for ECU pricing"
}
```

---

## Accessibility

- Keyboard navigation: Enter to submit
- Screen reader: "Wiring query input, type your wiring needs"
- Focus states: Visible border on focus
- Error states: Red border + error message

---

## Status

✅ **Component Created:** `WiringQueryContextBar.tsx`
⏳ **Integration:** Pending (VehicleProfile)
⏳ **Testing:** Pending
⏳ **Documentation:** Complete

---

## Next Steps

1. Integrate into VehicleProfile page
2. Add to Parts Quote Generator section
3. Test with real queries
4. Add loading states
5. Add error handling
6. Add quote display component

