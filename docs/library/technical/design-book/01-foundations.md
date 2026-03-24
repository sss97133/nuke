# DESIGN BOOK — Chapter 1: Foundations

The philosophy behind every visual decision. Not what the tokens are — that's the CSS file (`nuke_frontend/src/styles/unified-design-system.css`). This chapter explains **why**.

**Cross-references:**
- Token values: [TOKENS.md](./TOKENS.md)
- Violation patterns: [VIOLATIONS.md](./VIOLATIONS.md)
- ESLint enforcement: `nuke_frontend/eslint-plugin-design-system.js`

---

## Why Arial

Arial is the font that disappears.

Not in the literal sense — it's highly legible at every size. It disappears in the cognitive sense: the reader sees the words, not the letterforms. There's no personality to process, no aesthetic statement to evaluate, no era to identify.

Consider the alternatives:

**Helvetica** is the designer's sans-serif. When you choose Helvetica, you're saying: "I know about typography." It carries cultural weight — Swiss modernism, Massimo Vignelli, the New York subway. Helvetica is a statement. Nuke doesn't need to make a typographic statement. The data is the statement.

**System font stack** (`-apple-system, BlinkMacSystemFont, Segoe UI, ...`) adapts to each operating system. San Francisco on macOS, Segoe on Windows, Roboto on Android. The result: the same interface looks subtly different on every platform. For most applications, this is fine. For a data platform that aims for pixel-perfect consistency in information density, it's a problem. A column of numbers that aligns on macOS might misalign on Windows because Segoe UI has different metrics.

**Inter** is the interface font of the 2020s. Beautiful. Specifically designed for screens. But it carries an era — the same way Futura carries the 1920s and Optima carries the 1950s. Using Inter dates the interface to the 2020s. Nuke's design aspires to be era-less.

**Monospace for everything** (a temptation for a data platform) sacrifices readability in prose and labels. Monospace is for data — VINs, prices, timestamps. Human-readable text (labels, descriptions, navigation) needs proportional spacing to be comfortable at long reading lengths.

Arial is none of these things. It's proportional. It's universal. It has no era. It renders identically on every platform. It's been a system font since Windows 3.1 (1992) and macOS (as a Helvetica companion) for decades. Nobody notices Arial. That's the point.

**The rule:** Arial for everything human. Courier New for everything machine. Two fonts. No exceptions.

> **CSS token:** `--font-family: Arial, sans-serif`
> **ESLint rule:** `design-system/no-banned-fonts` — catches any `fontFamily` not in the allowed list
> **Violation:** [V-04](./VIOLATIONS.md#violation-v-04-wrong-font-family)

---

## Why Courier New

When the system speaks, it speaks in monospace.

Prices. VINs. Mileage readings. Timestamps. Extraction counts. Queue depths. These are not prose — they're readings. They come from machines (databases, APIs, scrapers) and they represent measurements (how much, how many, when, what identifier).

Courier New draws a visual boundary between human content and machine content. When you see monospace text in Nuke, your brain shifts into data-reading mode. When you see proportional text, you're reading labels, descriptions, navigation — the human layer that frames the data.

This separation matters because Nuke is a platform where human claims and machine measurements coexist. A seller's description ("beautiful original paint") is a claim — subjective, temporal, potentially inaccurate. The price ($24,500) is a measurement — objective, timestamped, sourced. Rendering them in different typefaces signals this distinction visually.

**Why Courier New specifically?** Because it's on every computer ever made. Like Arial, it's universal. A fancier monospace (Fira Code, JetBrains Mono, Berkeley Mono) would introduce an aesthetic opinion where none is needed. Courier New has no opinion. It's just monospace.

> **CSS token:** `--font-mono: 'Courier New', monospace`
> **ESLint rule:** `design-system/no-banned-fonts`
> **Violation:** [V-04](./VIOLATIONS.md#violation-v-04-wrong-font-family)

---

## Why 8-11px

The font size range is deliberately small. Here's why each size exists:

| Size | Role | Where Used |
|------|------|-----------|
| 8px | Micro labels | Badge labels, section headers, metadata captions, axis labels on charts |
| 9px | Small body | Secondary text, breadcrumbs, tab labels, nav links, badge text |
| 10px | Standard body | Primary content text, card titles, input text, button labels |
| 11px | Headings | Page titles, card section headers, dialog titles |

No size above 11px is used in the standard interface. No size below 8px is used anywhere.

**The philosophy:** Larger text is for marketing pages. Nuke is not a marketing page. It's a workstation. Workstation interfaces — Bloomberg terminals, air traffic control displays, mixing consoles — use small text because information density is more valuable than readability at arm's length.

The trade-off is explicit: users must sit at normal screen distance (18-24 inches). The interface is not designed for across-the-room readability, phone-at-arm's-length usage, or projection. It's designed for a person at a desk, focused, working.

The `--font-scale` CSS variable allows proportional scaling (0.9x to 1.2x) for accessibility. All font sizes reference this variable, so scaling is uniform across the interface. But the default is 1.0x — the 8-11px range is the intended experience.

**Why not 12px body text?** Because 12px is the web default, and the web default is designed for general-purpose reading. Nuke is not general-purpose. Every pixel of vertical space saved by smaller text is a pixel returned to the content — another row in a table, another card in the grid, another data point visible without scrolling.

> **CSS tokens:** `--fs-8` (8px), `--fs-9` (9px), `--fs-10` (10px), `--fs-11` (11px), `--fs-12` (12px rare)
> **Violation:** [V-05](./VIOLATIONS.md#violation-v-05-font-size-too-large), [V-15](./VIOLATIONS.md#violation-v-15-12px-font-size-on-data-labels-and-column-headers)

---

## Why Zero Border-Radius

```css
*, *::before, *::after {
  border-radius: 0 !important;
}
```

This is the most aggressive enforcement in the design system. Every element on screen has sharp corners. No exceptions. No special cases. Enforced with `!important` on the universal selector.

**Material honesty.** A screen is flat. Pixels are square. A container on a screen is a rectangular region bounded by straight lines. Rounded corners pretend that the container is a physical card with smoothed edges. It's a lie about materiality — the screen isn't made of paper or plastic. It's made of pixels.

Sharp corners say: this is a screen. These are boxes. Here is the edge. The honesty extends throughout the system. No shadows pretend to be light sources. No gradients pretend to be depth. The interface is flat because the medium is flat.

**Visual precision.** Rounded corners create ambiguity at element boundaries. Where exactly does the corner end and the straight edge begin? The 4px radius of one element might visually merge with the 8px radius of an adjacent element, creating an unclear boundary. Sharp corners eliminate this ambiguity. The edge is the edge.

**Timelessness.** Border-radius was zero from 1984 (original Macintosh) through 2000 (Windows XP was the first major OS with rounded elements). It was zero again in Windows 8 (2012) and Metro design. It's zero in Bloomberg Terminal, zero in command-line interfaces, zero in most financial and industrial software. Rounded corners cycle in and out of fashion. Sharp corners don't cycle — they persist.

**Information density.** Rounded corners waste pixels. A 12px border-radius on a card means 12 pixels of unusable corner in each direction — a total of ~452 square pixels lost per corner, ~1,808 per card. Multiply by a grid of 24 cards and you've wasted ~43,000 pixels on corner rounding. At small card sizes (as in Nuke's dense grid views), this waste is visible — content is pushed away from the corners for no functional reason.

> **CSS enforcement:** `*, *::before, *::after { border-radius: 0 !important; }`
> **CSS token:** `--radius: 0px`
> **ESLint rule:** `design-system/no-border-radius`
> **Violation:** [V-01](./VIOLATIONS.md#violation-v-01-border-radius-on-any-element)

---

## Why Zero Shadow

```css
*, *::before, *::after {
  box-shadow: none !important;
}
```

Same enforcement level as border-radius.

**Shadows are a lie about light.** A box-shadow implies a light source. But the light source on a screen is the screen itself — it's emissive, not reflective. There is no light source casting a shadow from an elevated card onto a background surface. The card isn't elevated. It's all the same flat plane.

**Shadows create false hierarchy.** Material Design (Google, 2014) used shadow elevation as a hierarchy signal: higher cards cast larger shadows, indicating they're "closer" to the user. This works in Material's z-axis metaphor. But Nuke doesn't use z-axis for hierarchy. Nuke uses borders, weight, and density. A vehicle card isn't "above" the background — it's a region of the background with a different visual treatment.

**Shadows fight borders.** In a system with 2px solid borders, shadows create visual noise. The border says "here is the edge." The shadow says "here is an edge too, but blurrier and slightly offset." Two edge signals for one element is redundant. The border is sufficient.

**The exception that proves the rule:** The search overlay and user dropdown use `box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2)`. This is the only shadow in the system. It's used on floating elements that truly do overlap content — and even this is debatable. It exists because without it, the overlay's edge merges with the content below in certain color configurations. This is a pragmatic exception, documented and contained.

> **CSS enforcement:** `*, *::before, *::after { box-shadow: none !important; }`
> **ESLint rule:** `design-system/no-box-shadow`
> **Violation:** [V-02](./VIOLATIONS.md#violation-v-02-box-shadow-for-depth-or-emphasis)

---

## Why 4px Spacing

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
```

The 4px base unit creates a grid that allows precise alignment at small scales.

**Why not 8px?** An 8px base unit (the standard in many design systems) is too coarse for data-dense interfaces. The difference between 8px and 16px padding is dramatic at small component sizes — it can be the difference between a compact data row and a spacious one. With 4px increments, we get finer control: 4px for tight inline gaps, 8px for standard padding, 12px for card padding, 16px for section spacing.

**Why not px values directly?** CSS variables ensure consistency. When `--space-2` means 8px everywhere, changing it to 10px changes the entire interface proportionally. The variables are the source of truth; the values are implementations.

**The alignment benefit:** At 4px increments, every element aligns to a 4px grid. This creates visual order even in complex layouts — columns of data, grids of cards, stacked badges all share the same underlying rhythm. The eye perceives this order even if the user can't articulate it. It feels "right" because everything is proportionally related.

> **CSS tokens:** `--space-1: 4px` through `--space-6: 24px`
> **Violation:** [V-17](./VIOLATIONS.md#violation-v-17-padding-or-margin-not-on-the-4px-grid), [V-19](./VIOLATIONS.md#violation-v-19-flexgrid-gaps-not-on-the-4px-grid)

---

## Why Greyscale First

The default palette is grey. Not grey and blue. Not grey and green. Grey.

```
Page:    #f5f5f5 (light) / #1e1e1e (dark)
Surface: #ebebeb / #252526
Hover:   #e0e0e0 / #2d2d30
Border:  #bdbdbd / #3e3e42
Text:    #2a2a2a / #cccccc
```

**Color means something.** Green means success, sold, confirmed. Orange means warning, above market, caution. Red means error, overpriced, ending. These semantic colors work because they're rare. If the interface were already colorful, a red badge would blend in. In a greyscale interface, a red badge screams.

**The absence of color IS the design.** Most interfaces use color for decoration — blue buttons, green headers, colored sidebar icons. In Nuke, the absence of decorative color means every instance of color carries meaning. There are no "pretty" colors. There are only "meaningful" colors.

**The dark grey principle.** The text color is #2a2a2a (light mode) and #cccccc (dark mode). Not pure black (#000000) or pure white (#ffffff). This is deliberate. Pure black on white creates maximum contrast, which is fatiguing for extended reading. Dark grey on light grey reduces contrast slightly — enough to ease fatigue while maintaining clear legibility. The effect is subtle but noticeable over a long session.

**Not desaturated — never saturated.** The greyscale palette isn't a "desaturated version of a colorful palette." It's the primary palette. Color is added where needed, not subtracted where unnecessary. The mental model should be: grey is the default, color is the exception.

> **CSS tokens:** `--bg: #f5f5f5`, `--surface: #ebebeb`, `--text: #2a2a2a`, `--border: #bdbdbd`, `--text-secondary: #666666` (light mode). See TOKENS.md for dark mode values.
> **ESLint rule:** `design-system/no-hardcoded-colors`
> **Violation:** [V-03](./VIOLATIONS.md#violation-v-03-hardcoded-hex-colors)

---

## Why Racing Accents as Easter Eggs

Gulf Blue. Martini Red. JPS Gold. British Racing Green. Papaya Orange. These are the accent colorways — and they're explicitly Easter eggs, never primary UI.

**The reward structure.** Gulf Blue doesn't appear on first use. It appears when you've explored the theme settings, when you've spent time with the interface, when you've earned familiarity. The discovery of accent colorways is a small delight — a reward for investment.

**Cultural resonance.** Every accent color is a livery — a racing team's identity painted on a car. Gulf's powder blue and orange. Martini's tricolor stripe. John Player Special's black and gold. These are visual languages that automotive enthusiasts recognize instantly. They connect the interface to the culture it serves.

**Never primary.** The accents modify `--accent` (the color used for active nav states, focus borders, and interactive highlights). They don't modify the core greyscale palette. The interface remains grey with colored accents — not a "Gulf Blue themed interface." The accent is a tint, not a takeover.

**The emotional layer.** Most software is emotionally neutral. The racing accents inject personality without compromising professionalism. It's the difference between a tool and a *tool you enjoy using*. The mechanic who puts racing stickers on their toolbox isn't less professional — they're more invested.

> **CSS tokens:** `data-accent="gulf"`, `data-accent="martini"`, `data-accent="jps"`, `data-accent="brg"`, `data-accent="papaya"`, and 15 more colorways. See TOKENS.md Racing Accent Colorways section.
> **Violation:** [V-07](./VIOLATIONS.md#violation-v-07-colored-borders-for-emphasis) (misusing accents as functional UI colors)

---

## The Bloomberg Terminal Inheritance

Nuke's visual language is descended from financial terminals, not consumer web applications.

**The shared problem:** Both Bloomberg Terminal and Nuke present large amounts of structured data to professional users who need to make decisions based on that data. The data is dense. The user is skilled. The premium is on information per screen, not aesthetics per pixel.

**What we inherit:**
- **Monospace for data.** Bloomberg uses monospace for prices, volumes, identifiers. Nuke uses Courier New for the same.
- **Dense layout.** Bloomberg packs every pixel. Nuke targets 8-11px text and 4px spacing for the same reason.
- **Minimal decoration.** Bloomberg has no rounded corners, no shadows, no gradients. Neither does Nuke.
- **Color means state.** Bloomberg uses green for up, red for down, yellow for alerts. Nuke uses green for success, red for error, orange for warning.
- **Keyboard-first.** Bloomberg is operated primarily through keyboard commands. Nuke's Cmd+K command input follows the same philosophy.

**What we don't inherit:**
- Bloomberg's cluttered multi-panel layout (optimized for multiple monitor setups)
- Bloomberg's dated typography (pre-antialiased bitmap fonts)
- Bloomberg's specific color palette (Nuke's greyscale is more muted than Bloomberg's higher-contrast defaults)

The inheritance is philosophical, not visual. We share the priorities (density, clarity, professionalism) but implement them for a modern web context.

---

## The Win95 Lineage

The DESIGN_GUIDE references "Windows 95 aesthetic." This is not nostalgia. It's recognition.

Windows 95 was the last mainstream operating system designed for pure information density without apology. Its buttons were rectangles. Its borders were straight lines. Its windows had titlebars that did exactly one thing: tell you the window's name. There was no decoration that didn't serve function.

**What Windows 95 got right:**
- **Borders communicate structure.** The 3D bevel effect (raised buttons, sunken input fields) used borders to communicate interactive affordance: raised = clickable, sunken = typeable. Nuke simplifies this to: 2px border = container, 1px border = internal divider.
- **Text density.** Win95's default font size was 8pt MS Sans Serif. The interface was designed for people who sat at desks and worked. Not glanced — worked.
- **Visual honesty.** A button looked like a button. A checkbox looked like a checkbox. There were no "flat" buttons that you had to hover to discover were buttons. Every interactive element announced itself through visual affordance.
- **No wasted space.** Window chrome was minimal. Toolbars were tight. Status bars were one line. Every pixel that wasn't functional was absent.

**What Windows 95 got wrong (and we correct):**
- The 3D bevel effect was decoration, not structure. It simulated physical buttons on a flat screen. We use flat borders instead — equally clear, less decorative.
- The color palette was limited by 8-bit displays. We have full color but choose restraint — greyscale by choice, not by limitation.
- The typography was limited by bitmap rendering. We have antialiased text but keep the sizes small by choice.

The Win95 reference is about values, not visuals. We value: density, honesty, functionality, restraint. Those values predate Windows 95 and will outlast it.

---

## The Transition Speed

```css
--transition: 180ms cubic-bezier(0.16, 1, 0.3, 1);
```

180 milliseconds. Not 200. Not 300. Not 150.

**Why 180ms?** Research on interface response time suggests:
- **< 100ms:** Perceived as instantaneous. Good for direct manipulation (dragging, typing).
- **100-200ms:** Perceived as responsive. Good for state transitions (hover, expand, collapse).
- **200-300ms:** Perceived as smooth. Good for navigation transitions.
- **> 300ms:** Perceived as deliberate. Often feels slow in repeated use.

180ms sits at the upper end of "responsive" — fast enough that the transition doesn't feel like waiting, slow enough that the eye can track the change. For an interface where users perform hundreds of interactions per session (clicking badges, expanding cards, hovering elements), each transition must be below the "deliberate" threshold.

**The easing curve:** `cubic-bezier(0.16, 1, 0.3, 1)` is a custom ease-out with a fast start and gradual deceleration. The element moves most of its distance in the first 60ms and settles into position over the remaining 120ms. This creates the illusion of responsiveness — the visual change begins immediately, then eases to rest.

**The rule:** No animation exceeds 180ms. This is enforced by convention, not by CSS — but the convention is strict. If an animation needs more than 180ms to communicate its effect, the animation should be redesigned or eliminated. The user doesn't wait for the interface. The interface keeps pace with the user.

> **CSS token:** `--transition: 0.12s ease` (default), `180ms cubic-bezier(0.16, 1, 0.3, 1)` (interaction standard)
> **CSS animation:** `@keyframes fadeIn180 { from { opacity: 0 } to { opacity: 1 } }` — used for panel open animations

---

## The Enforcement Philosophy

```css
*, *::before, *::after {
  border-radius: 0 !important;
  box-shadow: none !important;
}
```

The `!important` on the universal selector is unusual. It overrides everything — component libraries, third-party widgets, Tailwind utilities, inline styles. It's the nuclear option in CSS.

**Why so aggressive?**

Nuke has 92 legacy components that used the old design system. Tailwind classes are scattered throughout the codebase. Third-party libraries import their own styles. Without global enforcement, the design system would be aspirational — a guideline that individual components could ignore.

The `!important` enforcement makes the design system constitutional. It's not a guideline. It's law. A component cannot have rounded corners because the universe forbids it. A shadow cannot appear because the physics of this universe don't include shadows.

This has a cost: legitimate exceptions are hard to implement. The search overlay's shadow required an inline style with `!important` to override the global rule. This is intentional friction — it makes exceptions visible and deliberate rather than accidental and invisible.

**The philosophical principle:** Consistency is more valuable than flexibility. A design system that's 95% consistent and 5% inconsistent is worse than one that's 100% consistent, because the 5% creates cognitive overhead. The user must evaluate: "is this exception meaningful or accidental?" That evaluation is a microscopic instance of click anxiety. Eliminate the exceptions, eliminate the anxiety.

---

*"Every visual decision answers a question. Why this font? Because it disappears. Why this size? Because density is clarity. Why these corners? Because honesty has edges. Why this palette? Because color should mean something. The design system is the sum of these answers — not a style guide, but an epistemology of the screen."*
