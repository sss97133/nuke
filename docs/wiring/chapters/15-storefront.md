# Chapter 15: The Storefront

## Vision

The storefront is where the wiring system generates revenue. A builder designs a harness in the canvas, the BOM populates automatically, and they click "Order." Parts flow from suppliers through Nuke to the builder's bench.

## Revenue Model

### Tier 1: Referral Commissions
Builder orders from ProWire through Nuke's interface. ProWire pays 5-10% referral on connector kits, wire, and tools. No inventory risk.

### Tier 2: Curated Kits
Nuke pre-selects the exact parts for a specific build configuration. "LS3 + M130 + PDM30 Sensor Kit" = every sensor connector, pigtail, and terminal needed. Markup 15-25% over component cost.

### Tier 3: Complete Harness Packages
Partner with Desert Performance to offer turnkey harness builds. Customer provides vehicle and build spec through Nuke. Desert Performance builds the harness from Nuke's cut list and connector schedule. Nuke takes 10-15% of the build cost.

## Order Flow

```
Builder selects parts in catalog browser
    → BOM generated with supplier breakdown
    → "Order All" clicked
    → System groups items by supplier:
        ProWire: API order (connectors, wire, tools)
        Desert Performance: email with cut list PDF
        Engineered Vintage: Shopify cart link
        ACDelco: RockAuto affiliate link
    → Tracking numbers flow back into build status
    → Parts arrive → builder marks received
    → Build proceeds with verified BOM
```

## Current State

None of this is built. The data layer exists (catalog, pricing, manifest, BOM). The business logic exists (compute engine, supplier grouping). The storefront is the last mile — turning data into transactions.

## Dependencies

Before the storefront can launch:
1. **Catalog browser** (Chapter 14) must be functional
2. **ProWire API integration** must be established (or Shopify cart embedding)
3. **Desert Performance partnership** must be formalized (currently informal, same address)
4. **Payment processing** through Stripe or similar
5. **Shipping integration** for kit fulfillment
