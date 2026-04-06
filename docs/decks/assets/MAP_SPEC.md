# Luxe Fleet — Interactive St. Barths Map Spec

## Purpose
Full-viewport interactive map that tells the story visually: the island is covered in crappy rental brands, then Ford takes over. This is a standalone HTML file that gets embedded in the deck via iframe when ready.

## THIS IS NOT A ONE-OFF
The map data should enrich the actual Nuke database. Every location plotted here should have its GPS coordinates, business_type, and logo stored in the `organizations` table. The map renders FROM the DB, and the deck is just one consumer of that data.

**Before building the map:**
1. Ensure all SBH hotels, rental companies, restaurants, and venues exist as organizations in the DB
2. Ensure each has accurate lat/lng (from the villa cluster centroids or manual placement)
3. Ensure each has logo URLs stored in org_assets or brand_design_language
4. The map HTML pulls coordinates from a JSON export of the DB query, not hardcoded values

## Output
`docs/decks/assets/stbarth-map-v2.html` — standalone, self-contained, no external dependencies except Leaflet CDN + map tiles. Data embedded as JSON but sourced from a DB query.

---

## Data Source: Nuke DB
GPS coordinates MUST come from the database, not guesses. Query:
```sql
SELECT city,
  ROUND(AVG(latitude::numeric), 6) as lat,
  ROUND(AVG(longitude::numeric), 6) as lng,
  COUNT(*) as villas
FROM organizations
WHERE latitude BETWEEN 17.85 AND 17.95
  AND longitude BETWEEN -62.90 AND -62.79
  AND city IS NOT NULL
GROUP BY city ORDER BY count(*) DESC;
```

Results (confirmed):
| Neighborhood | Lat | Lng | Villas |
|---|---|---|---|
| St. Jean | 17.899594 | -62.834745 | 45 |
| Gustavia | 17.896555 | -62.849637 | 32 |
| Pointe Milou | 17.914975 | -62.815495 | 32 |
| Lurin | 17.892653 | -62.841693 | 30 |
| Colombier | 17.913168 | -62.860379 | 19 |
| Marigot | 17.909396 | -62.809860 | 18 |
| Corossol | 17.908791 | -62.856186 | 15 |
| Grand Cul de Sac | 17.906549 | -62.801440 | 14 |
| Flamands | 17.916559 | -62.856141 | 13 |
| Vitet | 17.903534 | -62.811274 | 13 |
| Petit Cul de Sac | 17.904402 | -62.794049 | 13 |
| Toiny | 17.897654 | -62.799782 | 12 |
| Lorient | 17.906079 | -62.827330 | 12 |
| Anse des Cayes | 17.911569 | -62.846017 | 11 |
| Gouverneur | 17.887459 | -62.837640 | 9 |
| Saline | 17.890751 | -62.822851 | 3 |

FBM confirmed GPS: 17.903078, -62.844146

---

## Scroll / Zoom Behavior
- `scrollWheelZoom: false` — vertical scroll passes through to the page (next slide)
- Pinch-to-zoom on mobile/trackpad
- +/- buttons (bottom right, dark styled)
- Drag to pan: enabled
- Initial view: center on island, zoom level shows entire island with some ocean

---

## Layer 1: Base Map
- CartoDB dark tiles: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`
- Dark theme matches deck aesthetic

## Layer 2: Location Labels (always visible)
Beaches and neighborhoods as **permanent text labels**. No dots, no pins, no boxes — just floating text.

- Beach names: teal (#4ECDC4), 9px, uppercase, 50% opacity
- Hotel names: gold (#CDA73C), 9px, uppercase, 50% opacity
- Positioned using DB coordinates above
- Labels should NOT overlap. Offset direction varies by position (right for west-side, left for east-side, etc.)

## Layer 3: Partner Logos (floating, no boxes)
Key partners shown as their **actual logos floating on the map**. NO background boxes, NO borders. Just the logo image with a drop-shadow for readability.

| Partner | Logo URL | Position | Size |
|---|---|---|---|
| Fouquet's | `https://a.storyblok.com/f/287000/189x62/d986c0daf7/logo-fouquet-s-saint-barth-white.svg` | Gustavia (17.8966, -62.8496) | 22px height |
| FBM | `https://fbm-autos.com/wp-content/uploads/2022/06/cropped-LOGO-blanc_Plan-de-travail-1.jpg` | Airport (17.9031, -62.8441) | 18px height |
| L'Officiel | `https://lofficielstbarth.com/images/logo-lofficiel-amtd.svg` | Gustavia area (17.8975, -62.8470) | 16px height |
| Ford | `https://www.fromtheroad.ford.com/dam/fordmediasite/ford-logo.png` | Moving on roads | 16px height |
| Eden Rock | Text "EDEN ROCK" in gold | St. Jean (17.9042, -62.8350) | 10px |
| Nikki Beach | `https://nikkibeach.com/wp-content/uploads/2024/07/logo-group-horizontal.svg` | St. Jean (17.9062, -62.8342) | 12px, brightness(10) |
| Rosewood | `https://www.rosewoodhotels.com/content/dam/rosewoodhotels/icons/Wordmark.svg` | GCdS (17.9094, -62.8060) | 12px, brightness(10) |
| Le Barthélemy | `https://lebarthelemyhotel.com/images/shared/Select_logo_new.png` | GCdS (17.9100, -62.8045) | 14px, brightness(10) |
| Le Toiny | `https://hotelletoiny.com/wp-content/uploads/2025/09/logo-1gom.webp` | Toiny (17.8970, -62.7990) | 14px, brightness(10) |
| Manapany | `https://360.agencewebcom.com/uploads/api/site-887/ckeditor/KEY-PARADISE-_SBH-LOGO_2024_NOIR-FOND-BLANC.png` | Anse des Cayes (17.9120, -62.8455) | 14px, brightness(10) |
| Cheval Blanc | Text "CHEVAL BLANC" in light gray | Flamands (17.9170, -62.8560) | 10px |
| Villa Marie | Text "VILLA MARIE" in gold | Colombier (17.9135, -62.8610) | 10px |

**Interaction:**
- Default: 40% opacity
- On hover: 100% opacity (CSS transition 0.2s)
- On click: popup with name + one-line description

## Layer 4: Competitor Logos (the ones that get wiped)
Current rental brands scattered near their actual operating locations (airport cluster + St. Jean). These represent the current automotive landscape.

| Brand | Color | Location |
|---|---|---|
| SUZUKI | #E4002B | Near airport |
| DACIA | #646B52 | Near airport |
| RENAULT | #FFCC00 | Near airport |
| MOKE | #88aa66 | St. Jean |
| MINI | #333 | Maurice rental / Gustavia |
| CHANGAN | #0066CC | Near airport |
| JEEP | #3B5323 | St. Jean |
| SMART | #aaa | Near airport |

Display as **small text labels** in brand color, 50% opacity. Positioned accurately near the rental companies that operate them (airport cluster: 17.903, -62.844; St. Jean: 17.905, -62.834).

**THE WIPE:**
- After 4 seconds on screen, all competitor labels **fade out and shrink** (opacity→0, scale→0.3, transition 1.5s ease)
- The Ford logos keep moving
- This tells the whole story: the old fleet disappears, Ford takes over the roads

## Layer 5: Moving Ford Vehicles
Ford Blue Oval logos (`ford-logo.png`, 16px height) that **continuously move** along the island's road network. NOT emoji. The actual Ford logo.

**5 routes, each a polyline of GPS coordinates following actual roads:**

Route 1 — Gustavia → Airport → St. Jean:
Follows the main road north from Gustavia harbor, past the airport, to St. Jean beach.
Start: 17.896, -62.849 → End: 17.905, -62.835

Route 2 — Airport → Corossol → Flamands → Colombier:
Northwest coast road.
Start: 17.903, -62.844 → End: 17.919, -62.868

Route 3 — St. Jean → Lorient → Grand Cul-de-Sac:
East coast road.
Start: 17.906, -62.835 → End: 17.907, -62.801

Route 4 — Gustavia → Lurin → Gouverneur:
South hill road (the steep narrow one — this is WHY you need a real vehicle).
Start: 17.896, -62.849 → End: 17.887, -62.838

Route 5 — St. Jean → Pointe Milou → Toiny:
Southeast circuit.
Start: 17.906, -62.835 → End: 17.898, -62.800

**Animation:**
- Each Ford logo moves continuously along its route using `requestAnimationFrame`
- When it reaches the end, it loops back to the start (or reverses)
- Different speeds (0.3-0.6) so they don't move in sync
- Stagger start positions (random offset along each path)
- Smooth interpolation between waypoints

## Layer 6: Info Overlay (top-left)
Small dark panel, positioned top-left, z-index above map:
```
SAINT-BARTHÉLEMY
Every destination needs a car.
No Uber. No taxi app. No public transit.
14 beaches. 50+ restaurants. 25 hotels. 600 villas.
300,000 visitors/year — 65% American.
```
Style: dark bg (rgba(26,26,46,0.92)), 1px border rgba(255,255,255,0.1), Inter font, sand color header, white title, gray body text.

## Layer 7: Legend (bottom-left)
Minimal. Just colored dots + labels:
- Teal: Beaches
- Gold: Hotels
- Pink: Restaurants (if shown)
- Ford Blue: Ford vehicles (moving)

## DO NOT
- Use emoji for vehicles
- Put logos inside boxes/containers
- Use fake GPS coordinates — only DB data
- Use hotel interior photos
- Add a table of contents
- Make the map scrollable with mousewheel (page must scroll through)
