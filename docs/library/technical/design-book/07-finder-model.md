# DESIGN BOOK — Chapter 7: The Finder-First Architecture

How the design system serves the product vision. An agent who understands this chapter will make better decisions in ambiguous situations.

---

## The Core Thesis

nuke.ag is a vehicle provenance engine. The underlying reality is a graph of facts about vehicles, ownership, events, and signals. The frontend is not the product — it is a window into the graph.

This means:
- The data topology leads. The UI follows.
- A screen is not a "page" — it is a view into a subset of the graph with a specific lens.
- The same data appears in multiple contexts (web app, CLI tool, MCP server, browser extension, third-party platform embeds) — the design system must work in all contexts.
- The "finder" mental model: the primary interaction is finding and exploring data. Features and apps are different lenses on the same backend.

---

## Design Implications

### Implication 1: Every element must earn its presence

There is no decorative content. Every element either shows data, enables navigation, or enables action. If it does none of these, it should not exist.

**Test:** For any element on screen, ask: "What data does this show? What can the user do with it?" If the answer is "nothing — it just looks nice," remove it.

**Examples:**
- A divider line between sections: acceptable only if it communicates boundary between data groups
- A gradient overlay on an image: not acceptable (decorative)
- A badge showing "1991": acceptable (shows year, clickable to explore all 1991 vehicles)
- A rounded card corner: not acceptable (decorative, violates zero-radius rule)

### Implication 2: Hierarchy through data density, not visual decoration

An important piece of information is shown with more data around it (context, history, related signals), not with larger text or brighter color. The signal's depth is visible through density, not decoration.

**Example:** A vehicle with 847 provenance signals does not have a bigger card than one with 3 signals. Instead, the 847-signal vehicle has more visible badges, more populated spec fields, a richer timeline, and denser observation data. The density IS the visual hierarchy.

### Implication 3: The interface should feel inevitable

When a user opens a vehicle profile, every number they might need should already be there. The design must not ask the user to click to reveal what they obviously need. Pre-fetch, pre-calculate, pre-render.

This is the operational meaning of the "Zero Click Anxiety" law from DESIGN_BIBLE.md. It is not just about making clicks reversible — it is about making clicks unnecessary for core data.

### Implication 4: The badge is the fundamental unit

The badge is the atomic element that both shows a data point AND enables depth navigation. The badge system is to Nuke what the `<a>` tag is to the web. Every data point is potentially a portal.

**Practical rule:** When building a new component that shows categorical data (year, make, model, source, condition, status), render it as a `<BadgePortal>`, not as plain text. Plain text is a missed navigation opportunity.

### Implication 5: Anti-vanity metrics

The design must not show numbers designed to make the user feel good. No "streak" badges. No "profile completion percentage" with a progress bar. No "engagement score."

The provenance score is a signal, not a gamification mechanic. Design every metric as if it is being read by an engineer deciding whether to buy a vehicle for $150,000. The metric must be trustworthy, not encouraging.

---

## The Multi-Surface Model

The same backend (Supabase + Edge Functions) surfaces through:

| Surface | Design System Applies? | Notes |
|---------|----------------------|-------|
| **Web App** (this project) | Fully | All tokens, all components, all rules |
| **MCP Server** | Data structure only | Text/JSON output; no visual design, but data vocabulary must match |
| **CLI** | Text output | Structured formatting; same data vocabulary |
| **Browser Extension** | Yes, for injected elements | Extension popup and injected elements follow the design system |
| **Third-Party Embeds** | Yes, for widget DOM | Tokens must work in a foreign DOM context |

**Design Rule:** Never make a UI decision that only works on the web app. Every data structure, every component API, every interaction pattern should be expressible in a headless/text context.

**Practical example:** The BadgePortal `dimension` and `value` props map to a filterable dimension that can be represented as a JSON key-value pair in the MCP server. When designing a new badge type, ask: "How would this appear in a CLI `--json` output?" If the answer is clear, the design is correct. If it is unclear, the design is wrong.

---

## Screen Architecture Principles

### 1. Every screen has a primary query

One data question it answers. If you cannot state the primary query in one sentence, the screen is doing too much.

| Screen | Primary Query |
|--------|--------------|
| Vehicle Profile | "Everything known about this vehicle" |
| Feed | "What vehicles match my interests?" |
| Search | "Which entities match this query?" |
| Auction Marketplace | "What auctions are active or recent?" |
| Portfolio | "What is the current value of my holdings?" |
| Organization Profile | "What does this organization offer?" |

### 2. Data leads, layout follows

The layout of a screen is determined by what data needs to be shown and how it relates, not by visual convention. A vehicle profile shows the graph around a vehicle. The layout reflects the graph.

Do not start with "I want a two-column layout." Start with "This vehicle has specs, images, timeline events, comments, and provenance signals. What is the most efficient way to show all of these with minimal scrolling?"

### 3. Screens are views, not destinations

Users should be able to deep-link to any state of any screen. URL parameters drive screen state. Never use component state for navigable screen states.

**Correct:** `/?tab=feed&sort=price-asc&make=porsche`
**Wrong:** Feed tab state stored only in React state, lost on page refresh

### 4. The finder model means search is always present

The command input in the header is always accessible. Any data element can be a starting point for a new search. The `Cmd+K` shortcut focuses the command input from anywhere.

---

## The Three Design Laws (Operational)

### Law 1: Every Data Point is a Live Badge

Every piece of data in the system should be displayable as a badge portal, wired to its source and depth. No static text is "just text" — it is a badge waiting to be wired.

**Implementation:** Use `<BadgePortal>` for every categorical data display. For data that cannot be a portal (free-form text, continuous values), it must still be clickable for provenance: clicking shows the source and confidence of the data point.

### Law 2: Zero Click Anxiety

The user must never hesitate before clicking. Every interaction is reversible. Every click can be undone. Nothing navigates away without explicit user action.

**Implementation:**
- Badge click: expands inline, closes on click/Escape/click-outside
- Card click (grid mode): expands inline, same close behavior
- Card click (gallery/technical): navigates via `<Link>`, but is predictable
- "OPEN PROFILE" button: explicit navigation action, clearly labeled
- Cmd/Ctrl+click: opens in new tab (browser standard)

### Law 3: See First, Know Later

Show the data first. Explain it on demand. The entry point is always the work (the image, the vehicle, the data) — not metadata, not a search result, not a list of explanations.

**Implementation:**
- Hero image is the first thing visible on vehicle profile
- Price and key specs are visible without scrolling
- BadgePortals show data values at idle, depth counts on hover, full context on click
- Explanations and provenance are one click deep, not zero clicks

---

*The interface is a window into the graph. Every design decision either opens the window wider or puts something in front of it. Open the window.*
