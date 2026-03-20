# /nuke-ops:audit-design

Audit the frontend against the Nuke design system. Catches violations and generates fix lists.

## Design System Rules (from unified-design-system.css)

- **Font**: Arial only. Courier New for data/numbers.
- **Border radius**: 0 everywhere. Zero exceptions.
- **Shadows**: None. Zero box-shadow.
- **Gradients**: None. Zero linear-gradient/radial-gradient.
- **Borders**: 2px solid. Colors from design tokens.
- **Labels**: ALL CAPS, 8-9px, letter-spacing 0.08em
- **Transitions**: 180ms cubic-bezier(0.16, 1, 0.3, 1)
- **Racing accents** (Gulf, Martini, JPS, BRG, Papaya): easter eggs only, never primary UI

## Instructions

### 1. Scan for Violations
```bash
cd /Users/skylar/nuke

# Border radius violations
grep -rn "border-radius" src/ --include="*.css" --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v "unified-design-system" | grep -v ": 0" | grep -v "border-radius: 0"

# Shadow violations
grep -rn "box-shadow" src/ --include="*.css" --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v "unified-design-system" | grep -v ": none" | grep -v "box-shadow: none"

# Gradient violations
grep -rn "linear-gradient\|radial-gradient" src/ --include="*.css" --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v "unified-design-system"

# Wrong font
grep -rn "font-family" src/ --include="*.css" --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v "unified-design-system" | grep -vi "arial\|courier"

# Rounded class usage (Tailwind)
grep -rn "rounded" src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules" | grep -v "rounded-none"
```

### 2. Check Design Token Usage
```bash
# Are components using CSS custom properties?
grep -rn "var(--nuke-" src/ --include="*.tsx" --include="*.css" | wc -l

# Hardcoded colors (should use tokens)
grep -rn "#[0-9a-fA-F]\{3,8\}" src/components/ --include="*.tsx" --include="*.css" | grep -v "node_modules" | head -30
```

### 3. Report Format

```
## Design Audit — [date]

### Violations Found: X

#### Border Radius (X violations)
- file:line — current value → fix to 0

#### Shadows (X violations)
- file:line — remove

#### Fonts (X violations)
- file:line — change to Arial/Courier New

### Compliance Score: X%
```

Write report to `.claude/DESIGN_AUDIT.md`.
