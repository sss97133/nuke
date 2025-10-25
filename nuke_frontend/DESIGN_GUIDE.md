# Nuke Platform Design Guide

**Last Updated:** October 24, 2025  
**Design System:** Windows 95 / Cursor aesthetic with modern functionality

---

## Core Principles

1. **Minimal & Functional** - No unnecessary decoration
2. **Uniform Text Size** - 8pt everywhere, no exceptions
3. **Flat Hierarchy** - Avoid nesting beyond 2 levels
4. **Instant Feedback** - 0.12s transitions, clear states
5. **Information Density** - Compact spacing, efficient layouts

---

## Typography

### Text Size Rules (STRICT)

- **Primary text:** `8pt` (`font-size: 8pt` or `--font-size`)
- **No other sizes allowed** - Not 10pt, not 12pt, not 14px
- **Exception:** Logo can be larger if needed

### Usage

```css
/* Correct */
.text { font-size: 8pt; }
.text { font-size: var(--font-size); }

/* WRONG - DO NOT USE */
.text { font-size: 12px; }
.text { font-size: 14px; }
.heading { font-size: 16px; }
```

### Font Family

```css
font-family: Arial, sans-serif;
/* Or use */
font-family: var(--font-family);
```

---

## Color Palette

### Background Colors

```css
--white: #ffffff;         /* Main backgrounds */
--grey-50: #fafafa;      /* Subtle backgrounds */
--grey-100: #f5f5f5;     /* Section backgrounds */
--grey-200: #eeeeee;     /* Hover states */
--grey-300: #e0e0e0;     /* Borders, dividers */
```

### Text Colors

```css
--text: #000000;         /* Primary text (black only) */
--text-muted: #424242;   /* Secondary text */
```

### Borders

```css
--border-light: #e0e0e0;
--border-medium: #bdbdbd;
--border-dark: #9e9e9e;
```

### Accent Colors (Minimal Use)

```css
--primary-color: #0ea5e9;  /* Links, primary actions */
--success: #28a745;         /* Success states */
--danger: #dc2626;          /* Errors */
```

**Rule:** Background should be light greys/white. Text should be black. Avoid colorful backgrounds.

---

## Spacing

### Space Scale

```css
--space-1: 4px;    /* Tiny gaps */
--space-2: 6px;    /* Small gaps */
--space-3: 8px;    /* Default gaps */
--space-4: 12px;   /* Section spacing */
--space-5: 16px;   /* Large spacing */
--space-6: 20px;
--space-8: 24px;
--space-10: 32px;
--space-12: 40px;
```

### Usage

```css
/* Correct - Use variables */
padding: var(--space-3);
margin-bottom: var(--space-4);
gap: var(--space-2);

/* Avoid hard-coded values */
padding: 8px;  /* Use var(--space-3) instead */
```

---

## Borders & Shadows

### Border Rules

- **Width:** `2px` for emphasis, `1px` for standard
- **Radius:** `0px` (sharp corners, no rounding)
- **Style:** `solid` for regular, `inset`/`outset` for Windows 95 buttons

```css
/* Standard borders */
border: 1px solid var(--border-light);
border: 2px solid var(--border-medium);

/* Windows 95 button style */
border: 2px outset var(--border-light);

/* NO BORDER RADIUS */
border-radius: 0px;  /* Correct */
border-radius: 4px;  /* WRONG */
```

### Shadows (Minimal)

```css
/* Subtle shadow only */
box-shadow: var(--shadow);  /* 0 1px 3px rgba(0,0,0,0.12) */

/* Avoid heavy shadows */
box-shadow: 0 10px 20px rgba(0,0,0,0.3);  /* WRONG */
```

---

## Component Patterns

### Cards

```tsx
// Correct - Single card
<div style={{
  background: 'var(--white)',
  border: '2px solid var(--border-medium)',
  padding: 'var(--space-3)'
}}>
  Content here
</div>

// WRONG - Nested cards
<div className="card">
  <div className="card">  {/* Don't nest cards! */}
    <div className="section">  {/* Too much nesting */}
      Content
    </div>
  </div>
</div>
```

**Rule:** Maximum 2 levels of visual nesting. Avoid card-in-card-in-section patterns.

### Buttons

```tsx
// Primary button
<button style={{
  background: 'var(--text)',
  color: 'var(--white)',
  border: '2px solid var(--text)',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: '8pt',
  cursor: 'pointer',
  transition: 'all 0.12s ease'
}}>
  Action
</button>

// Secondary button (Windows 95 style)
<button style={{
  background: 'var(--grey-200)',
  border: '2px outset var(--border-light)',
  padding: 'var(--space-2) var(--space-3)',
  fontSize: '8pt',
  cursor: 'pointer'
}}>
  Action
</button>
```

### Forms

```tsx
// Input field
<input style={{
  fontSize: '8pt',
  padding: 'var(--space-2)',
  border: '1px solid var(--border-medium)',
  background: 'var(--white)'
}} />

// Label
<label style={{
  fontSize: '8pt',
  color: 'var(--text-muted)',
  display: 'block',
  marginBottom: 'var(--space-1)'
}}>
  Field Name
</label>
```

---

## Transitions & Interactions

### Hover States

```css
.interactive-element {
  transition: all 0.12s ease;
}

.interactive-element:hover {
  transform: translateY(-2px);
  border-color: var(--text);
}
```

**Rule:** Use `0.12s` for transitions. Fast and crisp.

### Active States

```css
.button:active {
  border-style: inset;  /* Windows 95 pressed effect */
}
```

---

## Layout Patterns

### Grid Layouts

```tsx
// Responsive grid
<div style={{
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 'var(--space-3)'
}}>
  {/* Cards */}
</div>
```

### Two-Column Layout

```tsx
<div style={{
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-4)'
}}>
  <div>Left column</div>
  <div>Right column</div>
</div>
```

### Responsive Breakpoint

```css
@media (max-width: 768px) {
  .desktop-nav { display: none; }
  .mobile-menu { display: block; }
  
  /* Stack columns */
  .two-column {
    grid-template-columns: 1fr;
  }
}
```

---

## Common Mistakes to Avoid

### ❌ Don't Do This

```tsx
// Wrong: Multiple text sizes
<h1 style={{ fontSize: '24px' }}>Title</h1>
<p style={{ fontSize: '14px' }}>Content</p>
<small style={{ fontSize: '10px' }}>Small</small>

// Wrong: Nested cards
<div className="card">
  <div className="card-body">
    <div className="section">
      <div className="card">  {/* Too nested! */}
        Content
      </div>
    </div>
  </div>
</div>

// Wrong: Rounded corners
<div style={{ borderRadius: '8px' }}>Content</div>

// Wrong: Colorful backgrounds
<div style={{ background: 'linear-gradient(45deg, #ff6b6b, #4ecdc4)' }}>
  Content
</div>

// Wrong: Hard-coded spacing
<div style={{ padding: '12px', margin: '20px' }}>Content</div>
```

### ✅ Do This Instead

```tsx
// Correct: Uniform 8pt text
<div style={{ fontSize: '8pt', fontWeight: 'bold' }}>Title</div>
<div style={{ fontSize: '8pt' }}>Content</div>
<div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Small</div>

// Correct: Flat hierarchy
<div className="card">
  <div style={{ padding: 'var(--space-3)' }}>
    Content here
  </div>
</div>

// Correct: Sharp corners
<div style={{ borderRadius: '0px' }}>Content</div>

// Correct: Light backgrounds
<div style={{ background: 'var(--grey-100)' }}>
  Content
</div>

// Correct: Design system variables
<div style={{ 
  padding: 'var(--space-3)', 
  marginBottom: 'var(--space-4)' 
}}>
  Content
</div>
```

---

## Mobile Considerations

### Touch Targets

```tsx
// Minimum 44px height for mobile buttons
<button style={{
  minHeight: '44px',
  minWidth: '44px',
  fontSize: '8pt',
  padding: 'var(--space-2) var(--space-3)'
}}>
  Tap Me
</button>
```

### Responsive Text (Still 8pt)

```tsx
// Text stays 8pt on mobile
// Adjust layout, not text size
<div style={{
  fontSize: '8pt',
  padding: 'var(--space-2)'  // Smaller padding on mobile
}}>
  Content
</div>
```

---

## Component Checklist

Before committing a component, verify:

- [ ] All text is 8pt
- [ ] Uses design system variables (`--space-*`, `--grey-*`)
- [ ] No nested cards (max 2 levels)
- [ ] Border radius is 0px
- [ ] Transitions are 0.12s
- [ ] Borders are 1px or 2px
- [ ] Colors are from palette (no random colors)
- [ ] Touch targets >= 44px on mobile
- [ ] Works on both desktop and mobile

---

## Examples

### Good Component

```tsx
function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  return (
    <div style={{
      background: 'var(--white)',
      border: '2px solid var(--border-medium)',
      padding: 'var(--space-3)',
      transition: 'all 0.12s ease',
      cursor: 'pointer'
    }}>
      <div style={{ fontSize: '8pt', fontWeight: 'bold', marginBottom: 'var(--space-1)' }}>
        {vehicle.year} {vehicle.make} {vehicle.model}
      </div>
      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
        VIN: {vehicle.vin}
      </div>
    </div>
  );
}
```

---

## Resources

- **Design System CSS:** `/nuke_frontend/src/design-system.css`
- **Example Components:** `/nuke_frontend/src/pages/Market.tsx`
- **Layout Component:** `/nuke_frontend/src/components/layout/AppLayout.tsx`

---

## Questions?

When in doubt:
1. Check `design-system.css` for approved variables
2. Look at existing components in `/pages/Market.tsx`
3. Ask: "Is this 8pt? Is this flat? Is this Windows 95?"

**Remember:** Consistency > Creativity. Follow the rules.

