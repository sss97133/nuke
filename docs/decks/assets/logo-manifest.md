# Luxe Fleet — Logo & Image Manifest

Every brand mentioned in the deck MUST show its logo. No text-only brand references.

## USAGE RULES — When to use which variant

| Background | Fouquet's | L'Officiel | FBM | Ford |
|---|---|---|---|---|
| **Dark bg** | White SVG (native) | Dark SVG + `filter:brightness(0) invert(1)` | White JPG (native) | PNG + `filter:brightness(0) invert(1)` |
| **Light bg** | Black SVG: `https://a.storyblok.com/f/287000/189x62/f116ee783e/logo-fouquet-s-saint-barth-black.svg` | Dark SVG (native) | White JPG + `filter:invert(1)` | PNG (native blue oval) |
| **Map (dark tiles)** | White SVG, 40% opacity, 100% hover | Inverted, 40% opacity | White JPG, 40% opacity | PNG inverted, moving |

**Ford logo note:** The fromtheroad.ford.com PNG appears to have a colored background. Use `filter:brightness(0) invert(1)` to force white on dark backgrounds. On light backgrounds use it native. The ideal asset is an SVG Blue Oval from Ford Brand Standards — we don't have access yet.

## CONFIRMED WORKING LOGOS

| Brand | URL | Type | Notes |
|-------|-----|------|-------|
| Fouquet's | `https://a.storyblok.com/f/287000/189x62/d986c0daf7/logo-fouquet-s-saint-barth-white.svg` | SVG white | org_assets. Invert for light bg. |
| L'Officiel St Barth | `https://lofficielstbarth.com/images/logo-lofficiel-amtd.svg` | SVG dark | org_assets |
| FBM Automobiles | `https://fbm-autos.com/wp-content/uploads/2022/06/cropped-LOGO-blanc_Plan-de-travail-1.jpg` | JPG white | org_assets. White on dark. |
| Ford (editorial) | `https://www.fromtheroad.ford.com/content/dam/fordmediasite/sample/site/logos/fromtheroad_logo.svg` | SVG | fromtheroad branding |
| Nikki Beach | `https://nikkibeach.com/wp-content/uploads/2024/07/logo-group-horizontal.svg` | SVG | Confirmed |
| Barthloc | `https://www.barthloc.com/images/logo-green.png` | PNG green | Confirmed |
| Maurice Car Rental | `https://www.mauricecarrental.com/wp-content/themes/mauricecarrental/images/logo.jpg` | JPG | Confirmed |
| Rosewood | `https://www.rosewoodhotels.com/content/dam/rosewoodhotels/icons/Wordmark.svg` | SVG | Corporate wordmark |
| Le Toiny | `https://hotelletoiny.com/wp-content/uploads/2025/09/logo-1gom.webp` | WebP | Confirmed |
| Le Barthélemy | `https://lebarthelemyhotel.com/images/shared/Select_logo_new.png` | PNG | Confirmed |
| Manapany | `https://360.agencewebcom.com/uploads/api/site-887/ckeditor/KEY-PARADISE-_SBH-LOGO_2024_NOIR-FOND-BLANC.png` | PNG dark | Confirmed |
| Turbe (PBS Group) | `https://cdn.prod.website-files.com/684b22764426af393a644209/68c8351b8555477e7a279a01_Logo%20groupe%20PBS.svg` | SVG | Parent company |

## NEED MANUAL SOURCING

| Brand | Status | Fallback |
|-------|--------|----------|
| alice + olivia | JS-rendered, favicon only | Use `A+O` text in their brand font, or favicon: `https://www.aliceandolivia.com/on/demandware.static/Sites-aando-Site/-/default/dw610b72d9/images/favicons/favicon-96x96.png` |
| Eden Rock | Oetker site JS-rendered, no static logo | Use text `EDEN ROCK` in their brand style |
| Cheval Blanc | LVMH JS-rendered | Use text `CHEVAL BLANC` or favicon: `https://www.chevalblanc.com/favicon.ico` |
| Cool Rental St Barth | Site down/unreachable | Use text |
| TopLoc | Site unreachable | Use text |
| GTA | Site unreachable | Use text |
| SiBarth | JS-rendered, only favicon | Favicon: `https://sibarth.com/wp-content/uploads/2020/12/cropped-sibarth-favicon-32x32.png` or text |
| Villa Marie | Not scraped | Use text |

## CONFIRMED WORKING IMAGES

### Ford Bronco Roadster Concept (fromtheroad.ford.com — editorial use)
| File | Shows |
|------|-------|
| `Bronco-Roadster-Concept-01.jpg` | Hero 3/4 front |
| `Bronco-Roadster-Concept-04.jpg` | Interior/bench seat |
| `Bronco-Roadster-Concept-06.jpg` | Lakeside hero (cover of article) |
| `Bronco-Roadster-Concept-07.jpg` | Rear 3/4 |
| `Bronco-Roadster-Concept-08.jpg` | Detail |
| `Bronco-Roadster-Concept-10.jpg` | Action/driving |
| `Bronco-Roadster-Concept-11.jpg` | Side profile |
| `Bronco-Roadster-Concept-15.jpg` | Detail |
| `Bronco-Roadster-Concept-16.jpg` | Close up |
Base: `https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2025/bronco-roadster-concept/`

## STILL NEED — LANDSCAPE/LOCATION IMAGES
- SBH aerial view
- Gustavia harbor with boats
- Shell Beach from road approach
- Road to Gouverneur (steep, narrow — the "why you need a car" shot)
- FBM airport frontage with vehicles
- Broncos already on-island

These must come from: user's photo library, L'Officiel, L'Agence, or FBM directly.
