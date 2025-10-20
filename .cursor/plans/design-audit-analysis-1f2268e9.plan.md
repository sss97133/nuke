<!-- 1f2268e9-6c9c-47d5-8a0d-f486401a4a84 a0eb4edb-d3ab-4b24-8826-0174b8a7bea2 -->
# Design Audit & Rulebook Creation

## Overview

Systematically audit reference sites to extract proven UI/UX patterns and compile actionable design principles for the platform.

## Reference Sites to Audit

### Functionality Winners

1. **Craigslist** (Gallery/List/Map views) - Information density, filter efficiency, speed
2. **Bring a Trailer** - Community research, buyer/seller transparency, auction mechanics
3. **GitHub** (@sss97133) - Profile as portfolio, build documentation, contribution tracking

### Interaction Models  

4. **Twitch** - Live engagement, community building, content discovery
5. **pump.fun** - User profiles, asset tracking, gamification, social proof

### What NOT to Do

6. **Classic.com** - Over-designed but unloved, too sterile, no soul

### Aspirational Polish

7. **Cursor** - Modern UI, thick borders, polish, fit and finish

## Audit Process

### Phase 1: Deep Technical Analysis

For each reference site:

- Navigate and capture accessibility snapshots (reveals DOM structure, ARIA, component hierarchy)
- Inspect HTML structure and semantic markup patterns
- Extract CSS architecture (class naming conventions, layout systems, responsive patterns)
- Analyze JavaScript implementations (event handlers, state management, interaction patterns)
- Examine network requests and data flow
- Document component composition and reusable patterns
- Capture actual code snippets for reference

### Phase 2: Pattern Extraction

Extract patterns in these categories:

- **Information Architecture**: How data is organized and presented
- **Interaction Design**: Filters, navigation, actions, feedback
- **Visual Design**: Layout, density, whitespace, typography, color
- **User Flows**: How users move through core tasks
- **Community Features**: Social proof, contributions, reputation

### Phase 3: Rulebook Creation

Compile findings into `/Users/skylar/nuke/docs/DESIGN_RULEBOOK.md` with:

1. **Core Principles** (10-15 rules)

- Information density vs clarity balance
- Speed and performance requirements
- Community engagement patterns
- Profile-as-portfolio concepts

2. **Component Patterns**

- List/gallery/map view switching (Craigslist)
- Vehicle profile structure (GitHub + BaT hybrid)
- User contribution tracking (GitHub + pump.fun)
- Feed/discovery interface (Twitch-inspired)

3. **Anti-Patterns** (from Classic.com)

- What makes design feel sterile
- Over-engineering vs user value
- When polish becomes friction

4. **Implementation Priorities**

- Quick wins for immediate impact
- Medium-term UI system improvements
- Long-term platform evolution

## Key Files Referenced

- Current layout: `/Users/skylar/nuke/nuke_frontend/src/components/layout/AppLayout.tsx`
- Vehicle components: `/Users/skylar/nuke/nuke_frontend/src/components/vehicles/`
- Homepage: `/Users/skylar/nuke/nuke_frontend/src/pages/CursorHomepage.tsx`

## Deliverable

Comprehensive design rulebook document with screenshots, pattern examples, and specific recommendations for transforming the platform from "AI slop" to "polished tech company" UX.

### To-dos

- [ ] Audit Craigslist gallery/list/map views - extract information density, filter patterns, view switching mechanics
- [ ] Audit Bring a Trailer member profiles and listings - extract community research patterns, auction mechanics, transparency features
- [ ] Audit GitHub profile and repository structure - extract profile-as-portfolio patterns, contribution tracking, build documentation
- [ ] Audit Twitch and pump.fun - extract engagement patterns, feed mechanics, user/asset tracking, gamification
- [ ] Audit Classic.com as anti-pattern - document what makes sterile design fail despite technical competence
- [ ] Synthesize findings into 10-15 core design principles with specific examples from audited sites
- [ ] Document reusable component patterns for list views, profiles, feeds, and interaction models
- [ ] Compile comprehensive design rulebook markdown with screenshots, principles, patterns, and implementation priorities