# Plan: What We're Doing (Plain Language)

Four main areas. No jargon.

---

## 1. Better financials

**Goal:** Make money and performance easier to see and trust.

- Improve how we show revenue, costs, profit, margins (e.g. ShopFinancials and any org/dealer financial views).
- Clear date ranges, breakdowns (labor, parts, fees), and exports.
- Where it makes sense: connect to real data (events, transactions) so numbers are correct and consistent.

**Touchpoints:** ShopFinancials, org financial tabs, any dashboard that shows money.

---

## 2. Start the UI for analysis visuals

**Goal:** Get the analysis/charts UI in place so we can see trends and insights.

- Use what we have: ValueTrendsPanel, MiniLineChart, AdminAnalytics, BusinessIntelligence, MarketIntelligence.
- Add or wire up screens that show: value over time, segment performance, simple charts.
- Keep it simple at first: a few key charts and tables, then expand.

**Touchpoints:** Charts (ValueTrendsPanel, MiniLineChart), AdminAnalytics, BusinessIntelligence, MarketIntelligence, CursorHomepage/dashboard.

---

## 3. UI fixes — light mode and dark mode (colors and divs)

**Goal:** No more wrong colors or divs stuck in light mode when the app is in dark mode.

**How we fix it:**

1. Go through **every page** in the app.
2. View each page in **light mode**, then switch to **dark mode**.
3. Where something stays light (white/light gray background, hard-to-read text), find that div or component in the code.
4. Fix it: use theme variables (`var(--surface)`, `var(--bg)`, `var(--text)`) or add Tailwind `dark:` classes (e.g. `dark:bg-gray-800`, `dark:text-white`) so it respects dark mode.

**No need to change behavior** — only fix colors/backgrounds so light and dark both look right.

We have a list of pages to audit and a script (`scripts/inspect-theme.sh`) to help find likely spots. Rule: **ThemeProvider is the only place that sets light/dark; every page and div should follow it.**

---

## 4. Develop YONO — You Only Nuke Once (proprietary moat)

**Goal:** Build our differentiated product/moat: "You Only Nuke Once."

- **YONO** = the idea that you only need to do the heavy lift once (e.g. one great ingestion, one source of truth, one workflow) and Nuke handles the rest.
- This is product and positioning: define what "once" means (e.g. one import, one profile, one listing), and how we surface that in the UI and in messaging.
- Next steps: short YONO spec (what it is, who it’s for, one or two key flows), then a first UI or copy pass that makes YONO visible (landing, dashboard, or docs).

**Touchpoints:** To be defined — likely landing/marketing, dashboard headline, and one core flow (e.g. "Add vehicle once" or "Import once").

---

## Order of work (suggested)

1. **UI fixes (light/dark)** — Fast, visible, unblocks everything else. Do the page-by-page audit and fix divs/colors.
2. **Better financials** — Improve existing financial screens and data so they’re clear and correct.
3. **Analysis visuals UI** — Start the charts/analysis screens and wire them to real data where possible.
4. **YONO** — Define and then build the first slice (spec + one flow or one place in the app).

---

## Theme audit (for item 3)

See **THEME_AUDIT_PAGES.md** for the list of pages to check in light and dark mode, and how to fix "stuck on light" divs.
