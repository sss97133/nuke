# NUKE ATLAS

Geographic and institutional reference. Where things are, where data lives, where markets operate.

---

## Art World Geography

### Major Auction Markets

| City | Houses | Sale Calendar | Market Specialty |
|------|--------|--------------|-----------------|
| New York | Christie's, Sotheby's, Phillips, Heritage, Bonhams | May (spring), November (fall) | Contemporary, Impressionist, American |
| London | Christie's, Sotheby's, Phillips, Bonhams | February, June, October | Old Masters, Contemporary, British |
| Hong Kong | Christie's, Sotheby's, Phillips, Bonhams | March/April, October/November | Asian art, Contemporary (Asian collectors) |
| Paris | Christie's, Artcurial, Drouot | March, June, October | European, Art Deco, Design |
| Geneva | Christie's, Sotheby's | May, November | Jewelry, Watches (art secondary) |

### Gallery Districts

| City | Districts | Density | Notes |
|------|-----------|---------|-------|
| New York | Chelsea (20th-27th St), Lower East Side, Tribeca, Upper East Side (legacy) | Highest globally | Chelsea = primary market epicenter |
| London | Mayfair, Soho, Fitzrovia | High | Mayfair = blue chip |
| Paris | Marais, Saint-Germain, Avenue Matignon | High | Avenue Matignon = old guard |
| Los Angeles | Hollywood, Culver City, Downtown | Growing | Fastest growth market |
| Berlin | Mitte, Kreuzberg | Medium | Emerging, artist-driven |
| Hong Kong | Central, Wong Chuk Hang | Growing | Gateway to Asian collectors |

### Freeports (Black Zones)

| Location | Operator | Estimated Value Stored | Notes |
|----------|----------|----------------------|-------|
| Geneva | Geneva Freeport (GFZP) | $100B+ | Largest, oldest (est. 1888) |
| Luxembourg | Le Freeport | Unknown | Opened 2014, EU jurisdiction |
| Singapore | Singapore FreePort | Unknown | Opened 2010, Asia gateway |
| Delaware | Various | Unknown | US domestic tax structure |
| Monaco | — | Unknown | Small, elite clientele |

Freeport periods in provenance = black zones. Asset enters, identity of owner shielded, no public record of transfers inside. Duration of stay = data point.

### Museum Collection API Endpoints

| Museum | API Base | Auth | Format | Notes |
|--------|----------|------|--------|-------|
| Metropolitan Museum | `metmuseum.github.io` | None (open) | JSON | 500K+ objects, images CC0 |
| MoMA | `github.com/MuseumofModernArt/collection` | None (open) | JSON/CSV | 200K+ works |
| Tate | `github.com/tategallery/collection` | None (open) | CSV | 70K+ works |
| Rijksmuseum | `data.rijksmuseum.nl/object-metadata/api` | API key (free) | JSON | 1M+ objects |
| Art Institute Chicago | `api.artic.edu/api/v1/artworks` | None (open) | JSON | 120K+ works |
| Smithsonian | `api.si.edu` | API key (free) | JSON | 155M+ objects across institutions |
| Getty | `data.getty.edu` | None (open) | Linked Data | ULAN, AAT, TGN vocabularies |
| National Gallery of Art | `github.com/NationalGalleryOfArt/opendata` | None (open) | CSV | 150K+ works |
| Centre Pompidou | Scrape only | — | HTML | No public API |

### Art Fair Calendar

| Fair | City | Month | Tier | Focus |
|------|------|-------|------|-------|
| Art Basel | Basel | June | 1 | Contemporary, Modern |
| Art Basel Miami Beach | Miami | December | 1 | Contemporary |
| Art Basel Hong Kong | Hong Kong | March | 1 | Contemporary (Asia focus) |
| Frieze London | London | October | 1 | Contemporary |
| Frieze New York | New York | May | 1 | Contemporary |
| Frieze Los Angeles | LA | February | 1 | Contemporary |
| FIAC / Paris+ | Paris | October | 1 | Contemporary, Modern |
| TEFAF Maastricht | Maastricht | March | 1 | Old Masters, Antiques |
| Armory Show | New York | March | 2 | Contemporary |
| ADAA Art Show | New York | November | 2 | Established galleries |
| Art Dubai | Dubai | March | 2 | Contemporary (MENA/South Asia) |
| Liste | Basel | June | 3 | Emerging (alongside Art Basel) |

---

## Vehicle Market Geography

### Major Auction Markets

| City/Region | Houses | Calendar | Specialty |
|-------------|--------|----------|-----------|
| Scottsdale, AZ | Barrett-Jackson, Bonhams, RM Sotheby's, Gooding | January | Collector car week |
| Monterey/Pebble Beach, CA | RM Sotheby's, Gooding, Bonhams, Mecum | August | Concours, highest prices |
| Amelia Island, FL | Bonhams, Gooding, RM Sotheby's | March | East coast collector week |
| Kissimmee, FL | Mecum | January | Volume |
| Online | BaT, Cars & Bids | Year-round | Daily auctions |

### Key Forums by Marque

| Forum | Marque | Activity | Trust Score |
|-------|--------|---------|------------|
| Rennlist | Porsche | High | 0.45 |
| TheSamba | VW/Porsche (air-cooled) | High | 0.45 |
| Pelican Parts | Porsche | Medium | 0.45 |
| Corvette Forum | Corvette | High | 0.40 |
| HAMB (Jalopy Journal) | Hot rods, pre-war | High | 0.50 |
| Hemmings | All vintage | Medium | 0.45 |

### FB Marketplace Coverage

55 US metro areas scraped. National vintage rate ~12% of all vehicle listings. See `scripts/fb-marketplace-local-scraper.mjs`.

Key metros: Las Vegas, Phoenix, Los Angeles, Miami, Dallas, Houston, Atlanta, Chicago, Denver, Portland, Seattle.

---

## Publishing / Magazine Geography

### Key Art Magazines

| Title | Location | Frequency | Focus | Value to Nuke |
|-------|----------|-----------|-------|---------------|
| Artforum | New York | 10x/year | Contemporary art criticism | Highest-trust art validation |
| Frieze | London/New York | 8x/year | Contemporary art, culture | Strong international coverage |
| Art in America | New York | 6x/year | American contemporary | Broad US coverage |
| Parkett | Zurich (ceased 2017) | — | Artist collaborations | Historical archive (258 issues) |
| Mousse | Milan | 5x/year | Contemporary | European perspective |
| Flash Art | Milan | 6x/year | Contemporary international | Long history (est. 1967) |

### Key Fashion/Culture Magazines (Nuke Relevant)

| Title | Location | Focus | Why It Matters |
|-------|----------|-------|---------------|
| System | Paris | Fashion/art crossover | Bridges fashion and art worlds |
| Purple | Paris | Art/fashion/culture | Independent, high-signal |
| V Magazine | New York | Fashion/culture | High production value |
| Interview | New York | Art/culture (Warhol founded) | Artist/creative community |
| Document Journal | New York | Art/fashion | Emerging bridge publication |
| i-D | London | Fashion/youth culture | Street-level signal |

### Regional Publications (St. Barths Case Study)

The Caribbean magazine market is small, high-value, geographically concentrated. Ad spend intelligence is immediately actionable because:
- Limited titles = easy to map completely
- High per-page ad costs
- Luxury brand concentration
- Seasonal (winter) publishing cycle
- Gap analysis straightforward: if Brand X is in every title except yours, that's a brokerable lead

---

## Nuke Operational Geography

### Infrastructure

| Service | Region | Notes |
|---------|--------|-------|
| Supabase | us-west-1 | Primary database and edge functions |
| Vercel | — | Frontend hosting |
| GitHub | — | Code repository |

### User/founder location context

Las Vegas metro area. Boulder City workspace. Connections: St. Barths (magazine publishing), New York (art world, Perrotin/Powerhouse), Paris (gallery connections).
