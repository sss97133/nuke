# Dad Test — White-Label / "Make This My App"

**Status:** ready to run *after a prod deploy* (see Caveat). Validation kit for the
brand-as-projection hypothesis. One archetype, one question: does the ego hook fire?

## The hypothesis being tested

People don't want to use *your* app — they want to point at *their own* icon and
say "I built this." Dad (a hater of Skylar building this) is the perfect
archetype: maximum resistance, maximum convert-potential the moment the logo is
*his*. If he slaps his business on it and shows someone, the hypothesis is proven.

## The link

```
https://nuke.ag/?brand=org:viva-las-vegas-autos
```

This uses dad's **real business** — Viva! Las Vegas Autos (`businesses.slug =
viva-las-vegas-autos`) — not a synthetic mock. On load the app:
- swaps the wordmark to **VIVA! LAS VEGAS AUTOS**
- repaints the livery + browser-tab title
- generates a home-screen icon **from Viva's real logo**

Logo path verified 2026-06-16: the logo URL returns `200` +
`access-control-allow-origin: *`, so the canvas icon renders the **actual Viva
logo** (not the monogram fallback). Source: `businesses.logo_url` for
`c433d27e-2159-4f8c-b4ae-32a5e44a77cf`.

## iPhone walkthrough (what dad does, what he should see)

1. Open the link in **Safari** on his iPhone.
   → *Sees:* the app already wearing "VIVA! LAS VEGAS AUTOS" in the header, his
   colors, the tab titled with his business.
2. Tap the **Share** icon (square with up-arrow) → **Add to Home Screen**.
   → *Sees:* the add-sheet preview showing **his logo** as the icon and his
   business name as the label — no "Nuke" anywhere.
3. Tap **Add**.
   → *Result:* an icon on his home screen that is *his shop*. He taps it, it opens
   full-screen as "his app."

## The 3 questions to ask afterward (don't lead him)

1. "Did that feel like **your** app or someone else's?"
2. "Would you show it to anyone — a customer, a buddy at the shop?"
3. "What's missing before you'd actually use it?"

A yes/yes is the signal to invest in production (vanity URL `viva.nuke.ag`,
cross-device persistence). A shrug means the ego hook doesn't convert and we saved
ourselves the engineering.

## Caveat — must deploy first (gated on Skylar)

The branding engine (`nuke_frontend/src/branding/*`) is currently **local /
uncommitted**. The link above only reskins once that code is deployed to prod.
Two ways to run the test:
- **Deploy** the branding code to nuke.ag (Skylar's call — outward-facing), then
  the link works on dad's own phone anywhere.
- **Local network** (no deploy): dev server exposes `http://<lan-ip>:5174/?brand=org:viva-las-vegas-autos`
  — only works if dad's phone is on the same Wi-Fi, and A2HS from a LAN IP is
  clunky. Fine for a Skylar-holds-the-phone demo, not a real "his phone" test.

## Pre-flight checklist before handing dad the link

- [ ] Branding code deployed to nuke.ag (or run as same-network demo)
- [ ] Load the link yourself first — confirm the header reads VIVA! LAS VEGAS
      AUTOS and the generated icon shows the real logo (visual check still
      pending; only the logo fetch was verified headlessly this session)
- [ ] Do the A2HS flow on your own phone once so you can guide him

## Out of scope for the test (rewards for a positive result, not prerequisites)

- Custom subdomain `viva.nuke.ag` (needs `*.nuke.ag` wildcard DNS)
- Cross-device persistence of the brand choice
- iOS Focus-Filter auto-switching
