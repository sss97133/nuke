# 🎨 Mobile UI Design Audit

**Date:** October 28, 2025  
**Status:** ⚠️ **VIOLATIONS FOUND**  
**Goal:** Enforce design system consistency across all mobile components

---

## 📋 DESIGN SYSTEM RULES (design-system.css)

### Core Rules:
1. **Font Sizes:** ONLY 10px and 12px (8pt base)
2. **Colors:** Use CSS variables (var(--grey-200), var(--text), etc.) - NO hardcoded hex
3. **Border Radius:** 0px (classic flat style)
4. **Font Weight:** Normal (bold ONLY for hierarchy)
5. **User Preference:** Moderate contrast, uniform text size [[memory:4177398]]

---

## ❌ VIOLATIONS FOUND

### 1. **Font Size Chaos** (8+ different sizes used)

**MobileDocumentUploader.tsx:**
- ❌ 48px (emoji), 36px (category emoji), 24px (title), 18px (header)
- ❌ 14px (buttons/text), 13px (details), 12px (labels), 11px (meta)

**MobilePriceEditor.tsx:**
- ❌ 24px (price display), 18px (modal title), 16px (gain/loss)
- ❌ 14px (section text), 13px (history), 12px (fields), 11px (timestamp)

**MobileVehicleDataEditor.tsx:**
- ❌ 18px (header), 16px (section titles), 14px (buttons)
- ❌ 12px (inputs), 11px (field labels)

**MobileCommentBox.tsx:**
- ❌ 14px (input), 13px (comment text), 12px (metadata), 11px (timestamp)

**MobileTimelineHeatmap.tsx:**
- ❌ 18px (year header), 16px (modal title), 14px (event title)
- ❌ 12px (date), 11px (metadata), 9px (heatmap labels)

**RULE:** Design system allows ONLY 10px and 12px

---

### 2. **Hardcoded Color Hex Values**

**MobileVehicleProfile.tsx:**
- ❌ `#000080` (navy blue) - should be `var(--primary)` or design system color
- ❌ `#c0c0c0` (light grey) - should be `var(--grey-200)`
- ❌ `#808080` (medium grey) - should be `var(--grey-400)`
- ❌ `#ffffff` (white) - should be `var(--white)`
- ❌ `#008000` (green) - should be design system color

**RULE:** All colors must use CSS variables from design-system.css

---

### 3. **Border Radius Violations**

**Multiple Components:**
- ❌ `borderRadius: '2px'` - should be `0px` (classic flat)
- ❌ `borderRadius: '4px'` - should be `0px`
- ❌ `borderRadius: '8px'` - should be `0px`
- ❌ `borderRadius: '12px'` - should be `0px`
- ❌ `borderRadius: '50%'` (circles) - OK for avatars/dots

**RULE:** --radius: 0px for all rectangular elements

---

### 4. **Font Weight Inconsistencies**

- ❌ Using 'bold', '600', '700' throughout
- ✅ Should use 'normal' as default, 'bold' ONLY for headings/hierarchy

---

### 5. **Text Size Uniformity** (User Preference)

Current: Different font sizes create visual chaos  
Preferred: Uniform text size with bold for hierarchy [[memory:4177398]]

---

## ✅ WHAT'S CORRECT

1. **EnhancedMobileImageViewer.tsx** - Uses larger fonts intentionally for full-screen viewer (OK)
2. **Border styling** - 2px borders match Cursor design pattern (GOOD)
3. **Transition timing** - 0.12s matches Cursor pattern (GOOD)
4. **Windows 95 aesthetic** - Core concept is good, execution needs CSS variable consistency

---

## 🔧 REQUIRED FIXES

### Priority 1: Font Size Standardization
Replace ALL font sizes with:
- **Default text:** `var(--font-size)` (8pt / 10px)
- **Small text:** `var(--font-size-small)` (8pt / 10px) 
- **Headers:** Same size but `font-weight: bold`

### Priority 2: Color System Migration
Replace ALL hex colors with CSS variables:
```javascript
// ❌ OLD
background: '#000080'
color: '#ffffff'
border: '2px solid #808080'

// ✅ NEW
background: 'var(--primary)'
color: 'var(--white)'
border: '2px solid var(--border-medium)'
```

### Priority 3: Border Radius Fix
```javascript
// ❌ OLD
borderRadius: '4px'

// ✅ NEW
borderRadius: 'var(--radius)' // 0px
```

### Priority 4: Font Weight Discipline
```javascript
// ❌ OLD
fontWeight: 600
fontWeight: 'bold' // everywhere

// ✅ NEW
fontWeight: 'normal' // default
fontWeight: 'bold' // ONLY for section headers/hierarchy
```

---

## 📦 FILES REQUIRING FIXES

1. **MobileDocumentUploader.tsx** - 🔴 CRITICAL (font sizes, colors, radius)
2. **MobilePriceEditor.tsx** - 🔴 CRITICAL (font sizes, colors, radius)
3. **MobileVehicleDataEditor.tsx** - 🔴 CRITICAL (font sizes, colors, radius)
4. **MobileCommentBox.tsx** - 🟡 MEDIUM (font sizes)
5. **MobileTimelineHeatmap.tsx** - 🟡 MEDIUM (font sizes in badges)
6. **MobileVehicleProfile.tsx** - 🔴 CRITICAL (hardcoded hex colors everywhere)
7. **MobileOrgSwitcher.tsx** - 🟡 MEDIUM (font sizes, colors)
8. **MobileOrgDashboard.tsx** - 🟡 MEDIUM (font sizes, colors)

---

## 🎯 EXPECTED OUTCOME

After fixes:
- ✅ Uniform 10px text throughout (bold for hierarchy)
- ✅ All colors use CSS variables (themeable, consistent)
- ✅ Flat 0px borders (classic aesthetic)
- ✅ Visual consistency with desktop
- ✅ Adherence to user's moderate contrast preference
- ✅ Maintainable codebase (change design-system.css, affects all)

---

## 📊 SEVERITY SUMMARY

- **Font Size Violations:** 50+ instances across 8 files
- **Color Violations:** 30+ hardcoded hex values
- **Border Radius Violations:** 20+ instances
- **Font Weight Violations:** 15+ unnecessary bold usages

**Total:** ~115 design violations requiring fixes

---

## 💡 WHY THIS MATTERS

1. **Consistency:** Desktop follows design system, mobile doesn't
2. **Maintenance:** Hardcoded values = can't theme or update globally
3. **User Experience:** Different font sizes = visual noise [[memory:4177398]]
4. **Brand:** Design system exists for a reason - professional polish
5. **Accessibility:** Predictable text sizes improve readability

---

**Next Step:** Fix all violations systematically, file by file.


