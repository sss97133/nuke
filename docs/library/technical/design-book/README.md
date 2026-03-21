# DESIGN BOOK

The complete interface specification for Nuke. Every component, every interaction, every screen state.

Companion to [DESIGN_BIBLE.md](../../../DESIGN_BIBLE.md) which covers the three laws and visual identity. This book covers implementation — how the components actually work, what props they take, how they compose.

---

## Table of Contents

### [1. Foundations](./01-foundations.md)
Typography, color, spacing, borders. The CSS custom properties system. Light/dark themes. Racing accent colorways. The global enforcement rules (zero radius, zero shadow).

### [2. Components](./02-components.md)
Every reusable component spec'd. BadgePortal (the atomic unit), CardShell, CardImage, ResilientImage, BadgeClusterPanel, DetailPanel. Props, behavior, composition patterns.

### [3. Interactions](./03-interactions.md)
The click anxiety elimination model. Expand-don't-navigate. Context stacking. Every badge click behavior. Escape/click-outside collapse. Hover depth counts. Keyboard accessibility.

### [4. Screens](./04-screens.md)
Every page spec'd: Feed (grid/gallery/technical), Vehicle Profile, Search, Auctions. Empty states. Loading states. Error states. Every state has a next action.
