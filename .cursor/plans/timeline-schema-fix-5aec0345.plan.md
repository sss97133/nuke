<!-- 5aec0345-1027-4182-b4d1-133f713a8c0b 960146c7-2b55-4fa6-afd8-df80bc545aae -->
# Homepage Redesign - Cursor-Inspired UI

## Cursor Design Language Ethos

**Core Principles**:

1. **Minimalism First** - Remove decoration, focus on function
2. **Information Density** - Small text, tight spacing, more data per screen
3. **Dark Mode Native** - Dark theme primary, light as alternative
4. **Purposeful Color** - Gray scale dominant, accent colors for actions only
5. **Fast Interactions** - No animations/transitions unless functional
6. **Utility Over Flair** - Small buttons, clear labels, no marketing speak
7. **Monospace Where Appropriate** - Technical data in monospace fonts
8. **Clean Hierarchy** - Clear visual structure without heavy borders

## Current Homepage Problems

### Search Issues

1. ❌ Enter key doesn't trigger search (but code shows it should - investigate)
2. ❌ Search button styling unclear
3. ❌ Too much placeholder text

### Content Problems

1. ❌ Marketing-style "Platform Statistics" 
2. ❌ Large, decorative cards
3. ❌ Too much whitespace
4. ❌ Unclear value proposition
5. ❌ No dark mode support

## New Homepage Design

### Layout Structure

```
┌────────────────────────────────────────────┐
│ [Logo] n-zero        [Login] [Dark/Light] │  ← Minimal header, 32px height
├────────────────────────────────────────────┤
│                                            │
│  Vehicle marketplace & project tracker    │  ← One line tagline, 11px text
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │ Search...                       [⌘K] │ │  ← Clean search, Enter works
│  └──────────────────────────────────────┘ │
│                                            │
│  17 vehicles · 8 active today · 142 parts │  ← Dense stats, 10px text
│                                            │
├────────────────────────────────────────────┤
│ [Recent] [For Sale] [Projects] [Near Me]  │  ← Small pill buttons, 22px
├────────────────────────────────────────────┤
│                                            │
│ ┌─────┬─────────────────────────────────┐ │
│ │ IMG │ 1977 K5 Blazer  $42k  127 mi    │ │  ← Dense cards
│ │     │ Last update: 2h ago             │ │
│ └─────┴─────────────────────────────────┘ │
│                                            │
│ ┌─────┬─────────────────────────────────┐ │
│ │ IMG │ 1971 Bronco     $38k  Portland  │ │
│ │     │ 14 events · Engine rebuild      │ │
│ └─────┴─────────────────────────────────┘ │
│                                            │
└────────────────────────────────────────────┘
```

### Design Specifications

#### Dark Mode (Primary)

- Background: `#1e1e1e` (VSCode dark)
- Surface: `#252526`
- Border: `#3e3e42` (subtle)
- Text primary: `#cccccc`
- Text secondary: `#858585`
- Accent: `#007acc` (blue for actions)
- Success: `#4ec9b0`
- Warning: `#ce9178`

#### Light Mode

- Background: `#ffffff`
- Surface: `#f3f3f3`
- Border: `#e5e5e5`
- Text primary: `#1e1e1e`
- Text secondary: `#666666`
- Accent: `#0066cc`

#### Typography

- Sans: `"Inter", -apple-system, system-ui, sans-serif`
- Mono: `"SF Mono", "Monaco", "Cascadia Code", monospace`
- Sizes: 10px, 11px, 13px, 15px, 18px only
- Line heights: 1.4 for readability

#### Spacing

- Base unit: 4px
- Grid: 4px, 8px, 12px, 16px, 24px, 32px
- No arbitrary spacing

#### Components

**Search Bar**:

```css
height: 36px;
padding: 0 12px;
background: var(--surface);
border: 1px solid var(--border);
border-radius: 4px;
font-size: 13px;
transition: border-color 0.1s;

&:focus {
  border-color: var(--accent);
  outline: none;
}
```

**Utility Buttons**:

```css
height: 22px;
padding: 0 8px;
font-size: 11px;
background: var(--surface);
border: 1px solid var(--border);
border-radius: 3px;
cursor: pointer;

&:hover {
  background: var(--accent-dim);
}
```

**Vehicle Cards**:

```css
padding: 8px;
background: var(--surface);
border: 1px solid var(--border);
border-radius: 4px;
display: flex;
gap: 8px;

.thumbnail {
  width: 64px;
  height: 64px;
  border-radius: 2px;
}

.title {
  font-size: 13px;
  font-weight: 500;
}

.meta {
  font-size: 10px;
  color: var(--text-secondary);
}
```

## Implementation Plan

### Phase 1: Search Fix (Immediate)

**File**: `nuke_frontend/src/components/search/IntelligentSearch.tsx`

Issues to investigate:

1. Check if form `onSubmit` is properly bound
2. Verify no event.preventDefault() blocking Enter
3. Test in production bundle
4. Add explicit keyboard handler if needed
```typescript
// Add keyboard shortcut
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInputRef.current?.focus();
    }
    if (e.key === 'Enter' && document.activeElement === searchInputRef.current) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };
  
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [query]);
```


### Phase 2: Dark Mode System

**File**: `nuke_frontend/src/contexts/ThemeContext.tsx` (new)

```typescript
export const ThemeProvider: React.FC = ({ children }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  
  useEffect(() => {
    // Load from localStorage
    const saved = localStorage.getItem('theme');
    if (saved) setTheme(saved as any);
    
    // Apply to document
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
```

### Phase 3: Homepage Redesign

**File**: `nuke_frontend/src/pages/Discovery.tsx`

New structure:

```tsx
<div className="cursor-homepage">
  {/* Minimal Header */}
  <header className="minimal-header">
    <Logo size="small" />
    <div className="header-actions">
      <ThemeToggle />
      <AuthButton />
    </div>
  </header>

  {/* Hero Section - Compact */}
  <section className="hero-compact">
    <h1 className="tagline">Vehicle marketplace & project tracker</h1>
    
    {/* Clean Search */}
    <SearchBar 
      onEnter={handleSearch}
      placeholder="Search vehicles, parts, or projects..."
      shortcut="⌘K"
    />
    
    {/* Dense Stats */}
    <div className="stats-inline">
      <StatPill label="vehicles" value={stats.totalVehicles} />
      <StatPill label="active today" value={stats.activeToday} />
      <StatPill label="parts listed" value={stats.partsCount} />
    </div>
  </section>

  {/* Filter Pills */}
  <nav className="filter-pills">
    <FilterPill active>Recent</FilterPill>
    <FilterPill>For Sale</FilterPill>
    <FilterPill>Projects</FilterPill>
    <FilterPill>Near Me</FilterPill>
  </nav>

  {/* Dense Vehicle Grid */}
  <section className="vehicle-grid-dense">
    {vehicles.map(v => (
      <VehicleCardDense key={v.id} vehicle={v} />
    ))}
  </section>
</div>
```

### Phase 4: CSS Design System

**File**: `nuke_frontend/src/styles/cursor-design-system.css`

```css
/* Cursor Design System */
:root[data-theme="dark"] {
  --bg: #1e1e1e;
  --surface: #252526;
  --surface-hover: #2d2d30;
  --border: #3e3e42;
  --border-focus: #007acc;
  --text: #cccccc;
  --text-secondary: #858585;
  --text-disabled: #656565;
  --accent: #007acc;
  --accent-dim: rgba(0, 122, 204, 0.1);
  --success: #4ec9b0;
  --warning: #ce9178;
  --error: #f48771;
}

:root[data-theme="light"] {
  --bg: #ffffff;
  --surface: #f3f3f3;
  --surface-hover: #e8e8e8;
  --border: #e5e5e5;
  --border-focus: #0066cc;
  --text: #1e1e1e;
  --text-secondary: #666666;
  --text-disabled: #999999;
  --accent: #0066cc;
  --accent-dim: rgba(0, 102, 204, 0.1);
  --success: #16825d;
  --warning: #b05a00;
  --error: #d13438;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: "Inter", -apple-system, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  margin: 0;
  padding: 0;
}

/* Utility Classes */
.text-xs { font-size: 10px; }
.text-sm { font-size: 11px; }
.text-base { font-size: 13px; }
.text-lg { font-size: 15px; }
.text-xl { font-size: 18px; }

.font-mono { font-family: "SF Mono", Monaco, monospace; }

.cursor-button {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s;
}

.cursor-button:hover {
  background: var(--surface-hover);
}

.cursor-button:active {
  background: var(--accent-dim);
}
```

## Content Strategy

### Old Value Proposition

❌ "Build. Track. Share your restoration journey."

❌ Marketing fluff

❌ Unclear what platform does

### New Value Proposition

✅ "Vehicle marketplace & project tracker"

✅ Clear, direct, functional

✅ No marketing speak

### Homepage Sections (Prioritized)

1. **Search** - Primary action, always visible
2. **Quick Stats** - Context at a glance (dense, inline)
3. **Filter Pills** - Fast filtering without dropdowns
4. **Vehicle Grid** - Dense cards showing key data
5. **Advanced Filters** - Collapsed by default

### Vehicle Card Content (Dense)

Show only:

- Thumbnail (64x64px)
- Year/Make/Model (13px)
- Price (if for sale) (11px, mono)
- Location or last update (10px, secondary)
- Key metric (events/miles/status) (10px, secondary)

Hide:

- Long descriptions
- Multiple images
- Owner info (unless relevant)
- Unnecessary metadata

## Testing Checklist

**Search Functionality**:

- [ ] Enter key triggers search
- [ ] ⌘K focuses search bar
- [ ] Escape clears search
- [ ] Results load instantly
- [ ] Loading state is minimal

**Dark/Light Mode**:

- [ ] Toggle works instantly
- [ ] Preference saves to localStorage
- [ ] All components support both modes
- [ ] No flash on page load
- [ ] Colors meet contrast requirements

**Responsiveness**:

- [ ] Desktop: 3-column grid
- [ ] Tablet: 2-column grid
- [ ] Mobile: 1-column with same density
- [ ] Touch targets ≥44px on mobile

**Performance**:

- [ ] Initial load <2s
- [ ] Search results <500ms
- [ ] No layout shift
- [ ] Smooth scrolling

## Migration Plan

1. **Create new theme system** (no breaking changes)
2. **Add dark mode CSS** (opt-in initially)
3. **Redesign Discovery page** (parallel to current)
4. **Test with users** (A/B if needed)
5. **Roll out** (make default)
6. **Deprecate old styles** (cleanup after 30 days)

## Critical Foundation Work (Before Homepage)

**Must be bulletproof first**:

1. **Data Pipelines**:

   - Vehicle profile pipeline
   - User profile pipeline
   - Timeline event pipeline
   - Image pipeline (with real-time EXIF)
   - Receipt/documentation pipeline

2. **RLS & Ownership**:

   - Row Level Security per user
   - Ownership roles (owner, contributor, viewer)
   - Participation security
   - Simple for users (what they're used to)

3. **Real-Time Infrastructure**:

   - Supabase Realtime subscriptions
   - Live viewer counts
   - Live price updates
   - Live event publishing
   - WebSocket connections for streaming

4. **Financial Backend** (ASAP):

   - Staking system (legally sound)
   - Money storage/escrow
   - Share price calculation (value ÷ 1000)
   - ETF groupings (Squarebody ETF, etc.)
   - Tips/donations flow
   - Financial tools for builders

## Implementation Priority

**Phase 0: Foundation** (Do First):

1. Solidify data pipelines
2. Lock down RLS/ownership
3. Set up real-time infrastructure
4. Build financial backend (legally)

**Phase 1: Search & Core**:

1. Live instant search
2. Real-time feed
3. Cursor theme unification (everywhere)

**Phase 2: Vehicle Cards**:

1. Swipeable images with pinch zoom
2. Live indicators (viewers, updates)
3. AI-generated key metrics
4. Financial display (price, shares, staking)

**Phase 3: Content Groups**:

1. Vehicles discovery
2. Users discovery
3. Deals section
4. Innovation showcase
5. Financial opportunities (ETFs, staking)

**Phase 4: Advanced**:

1. Live streaming integration
2. Real-time tips
3. Work-in-progress feeds
4. View accumulation & buzz generation

### To-dos

- [ ] Fix search Enter key functionality - add explicit keyboard handler
- [ ] Create ThemeContext and dark/light mode toggle
- [ ] Build Cursor design system CSS with CSS variables
- [ ] Redesign Discovery page with dense, Cursor-inspired layout
- [ ] Add ⌘K keyboard shortcut to focus search
- [ ] Create VehicleCardDense component with 64px thumbnails
- [ ] Replace dropdown filters with inline pill buttons
- [ ] Convert platform stats to inline pills (10px text)