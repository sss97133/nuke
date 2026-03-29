# ATLAS: Data Sources Registry

**Snapshot date:** 2026-03-28
**Source:** `observation_sources` table (production database)
**Total registered sources:** 119

This is the canonical map of every data source the platform knows about. Each source has a trust score, access method, and current status. Sources are registered in the `observation_sources` table and referenced by slug throughout the pipeline.

---

## Source Categories at a Glance

| Category | Count | Trust Range | Description |
|----------|------:|------------|-------------|
| Auction | 27 | 0.40 - 0.90 | Live and online auction houses |
| Marketplace | 28 | 0.10 - 0.80 | Fixed-price and classified listings |
| Registry | 29 | 0.80 - 0.98 | Marque registries, government databases, authentication authorities |
| Forum | 11 | 0.50 - 0.70 | Enthusiast community forums |
| Social Media | 11 | 0.25 - 0.50 | Social platforms with vehicle content |
| Shop | 10 | 0.60 - 0.90 | Restoration shops and builders |
| Dealer | 14 | 0.60 - 0.75 | Classic car dealerships |
| Owner | 6 | 0.70 - 1.00 | First-party owner data (photos, messages, receipts) |
| Internal | 8 | 0.40 - 0.80 | AI pipelines and internal processing |
| Aggregator | 3 | 0.65 - 0.70 | Multi-source listing aggregators |
| Documentation | 1 | 0.70 | OCR pipelines for physical documents |
| Museum | 1 | 0.80 | Museum collections |

---

## Auction Sources (27)

| Slug | Name | Trust | Base URL | Auth | Rate Limit | Notes |
|------|------|------:|----------|:----:|:----------:|-------|
| `bat` | Bring a Trailer | 0.85 | bringatrailer.com | No | ~1/3s + jitter | Primary source. 131K vehicles. Curated, comment-scrutinized. Legacy slugs: 'bringatrailer', 'bat'. |
| `bonhams` | Bonhams | 0.90 | bonhams.com | No | — | Premium auction house. 9.2K vehicles. |
| `gooding` | Gooding & Company | 0.90 | goodingco.com | No | — | Premium auction house. 1.5K vehicles. |
| `rm-sothebys` | RM Sotheby's | 0.90 | rmsothebys.com | No | — | Premium auction house. 1.3K vehicles. |
| `broad-arrow` | Broad Arrow Auctions | 0.80 | broadarrowauctions.com | No | — | Premium collector auctions. 1.8K vehicles. Edge function exists. |
| `broad_arrow` | Broad Arrow | 0.85 | — | No | — | Duplicate slug (legacy). |
| `cars-and-bids` | Cars & Bids | 0.80 | carsandbids.com | No | — | JS SPA, requires Firecrawl. 1.7K vehicles. Slug aliases: 'cars_and_bids', 'carsandbids'. |
| `cars_and_bids` | Cars & Bids | 0.85 | — | No | — | Duplicate slug (legacy). |
| `mecum` | Mecum Auctions | 0.75 | mecum.com | No | — | High-volume auction. 44.5K vehicles. JS-heavy pages. |
| `barrett-jackson` | Barrett-Jackson | 0.75 | barrett-jackson.com | No | — | Major auction house. 5.5K vehicles. Strapi API behind Cloudflare. |
| `collecting-cars` | Collecting Cars | 0.80 | collectingcars.com | No | — | UK-based online auction. 848 vehicles. Edge function: collecting-cars-discovery. |
| `copart` | Copart (Salvage Auctions) | 0.85 | copart.com | No | — | Largest salvage auction. Critical for rebuilt title detection. |
| `iaa` | IAA (Insurance Auto Auctions) | 0.85 | iaai.com | No | — | Second largest salvage auction after Copart. |
| `manheim` | Manheim (Wholesale Auctions) | 0.80 | manheim.com | **Yes** | — | Largest wholesale auction. Access restricted. |
| `pcarmarket` | PCarMarket | 0.80 | pcarmarket.com | No | — | Porsche-focused. 5.5K vehicles. |
| `sbx-cars` | SBX Cars | 0.80 | — | No | — | 141 vehicles. |
| `russo-and-steele` | Russo and Steele | 0.75 | russoandsteele.com | No | — | Scottsdale auction house. |
| `allcollectorcars` | AllCollectorCars | 0.65 | allcollectorcars.com | No | — | — |
| `autohunter` | AutoHunter | 0.70 | autohunter.com | No | — | — |
| `autozen` | Autozen | 0.50 | autozen.com | No | — | — |
| `bid-garage` | Bid Garage | 0.60 | bidgarage.com | No | — | — |
| `dupontregistry` | Dupontregistry | 0.50 | dupontregistry.com | No | — | — |
| `guyswithrides` | GuysWithRides | 0.60 | guyswithrides.com | No | — | — |
| `silodrome` | Silodrome | 0.50 | silodrome.com | No | — | — |
| `themarket-bonhams` | The Market by Bonhams | 0.80 | — | No | — | — |
| `themarket-co` | Themarket | 0.50 | themarket.co.uk | No | — | — |
| `atm-auctions` | ATM Auctions (Monroe, NC) | 0.40 | soldwithatm.com | No | — | Regional estate liquidation. Vehicles are incidental lots. |

---

## Marketplace Sources (28)

| Slug | Name | Trust | Base URL | Auth | Notes |
|------|------|------:|----------|:----:|-------|
| `facebook_marketplace` | Facebook Marketplace | 0.60 | — | No | 27.8K vehicles. Logged-out GraphQL with `doc_id=33269364996041474`. Residential IP required. |
| `classiccars-com` | ClassicCars.com | 0.65 | classiccars.com | No | 34.6K vehicles. |
| `craigslist` | Craigslist | 0.40 | — | No | 4.7K vehicles. |
| `hagerty-marketplace` | Hagerty Marketplace | 0.70 | hagerty.com | No | Slug alias: 'hagerty'. |
| `motorious` | Motorious | 0.60 | buy.motorious.com | No | 46 vehicles. |
| `classicdriver` | Classic Driver | 0.75 | classicdriver.com | No | European focus. AJAX-heavy. |
| `classic-driver` | Classic Driver | 0.80 | — | No | Duplicate slug. |
| `autotrader` | Autotrader | 0.50 | autotrader.com | No | — |
| `autotrader-classics` | AutoTrader Classics | 0.75 | classics.autotrader.com | **Yes** | BLOCKED: Akamai WAF. Explicitly blocks Claude/Anthropic bots. Not viable without partnership. |
| `barnfinds` | Barn Finds | 0.55 | — | No | — |
| `bfreclassics` | Bfreclassics | 0.50 | bfreclassics.com | No | — |
| `carandclassic` | Car and Classic | 0.75 | carandclassic.com | No | UK-based. Currently blocked. |
| `dupont-registry` | duPont REGISTRY | 0.70 | dupontregistry.com/autos | No | — |
| `dupont-registry-invest` | duPont REGISTRY Invest | 0.70 | invest.dupontregistry.com | No | SEC-qualified fractional shares via Rally. |
| `dyler` | Dyler | 0.60 | dyler.com | No | — |
| `elferspot` | Elferspot | 0.70 | elferspot.com | No | — |
| `elitecars` | Elitecars | 0.50 | elitecars.com | No | — |
| `exotic-car-trader` | Exotic Car Trader | 0.65 | exoticcartrader.com | No | — |
| `facebook-saved` | Facebook Saved Items | 0.55 | — | No | — |
| `mcq-markets` | MCQ Markets | 0.65 | mcqmarkets.com | No | Reg A+ fractional exotic car shares. |
| `mph` | MPH | 0.70 | mph.com | No | — |
| `oldcaronline` | Old Car Online | 0.70 | oldcaronline.com | No | 4,300+ listings. |
| `oldcars-com` | Old Cars | 0.10 | oldcars.com | No | LOW QUALITY. Do not extract. |
| `rally-rd` | Rally Rd. | 0.70 | rallyrd.com | No | Fractional equity shares. SEC-registered. ~400K investors. |
| `thecarcrowd` | TheCarCrowd | 0.65 | thecarcrowd.uk | No | UK fractional classic car equity. |
| `throtl` | Throtl | 0.50 | — | No | — |
| `hemmings` | Hemmings | 0.75 | hemmings.com | No | 30 vehicles. Classic car marketplace. |
| `craigslist_archive` | Craigslist Saved Listings (2017-2018) | 0.60 | — | No | Historical archive. |

---

## Registry / Authority Sources (29)

These are the highest-trust sources: manufacturer archives, marque registries, government databases, and authentication authorities. Trust scores 0.80-0.98.

| Slug | Name | Trust | Base URL | Auth | Notes |
|------|------|------:|----------|:----:|-------|
| `ferrari-classiche` | Ferrari Classiche | 0.98 | ferrari.com/en-EN/auto/classiche | No | Official Ferrari certification and archives. |
| `galen-govier` | Galen Govier (Mopar Authority) | 0.98 | galengovier.com | No | THE authority on Mopar fender tag decoding. |
| `lamborghini-polo` | Lamborghini Polo Storico | 0.98 | lamborghini.com | No | Official Lamborghini certification. |
| `porsche-certificate` | Porsche Certificate of Authenticity | 0.98 | porsche.com | No | Official Porsche production records. |
| `yenko-registry` | Yenko Registry | 0.97 | yenko.net | No | Official Yenko Chevrolet registry. Data in forum threads. |
| `aston-works` | Aston Martin Works | 0.95 | astonmartinworks.com | No | Official Aston heritage. |
| `bmw-classic` | BMW Group Classic | 0.95 | bmwgroup-classic.com | No | Official BMW heritage archives. |
| `jaguar-heritage` | Jaguar Daimler Heritage Trust | 0.95 | jaguarheritage.com | No | Official Jaguar records. |
| `mercedes-classic` | Mercedes-Benz Classic | 0.95 | mercedes-benz.com/en/classic/ | No | Official Mercedes archives. |
| `mmc-detroit` | MMC Detroit (ICCA) | 0.95 | mmcdetroit.com | No | Muscle car authentication, WISE reports. |
| `nhtsa` | NHTSA | 0.95 | vpic.nhtsa.dot.gov/api/ | No | Free federal VIN API. No rate limits. |
| `nmvtis` | NMVTIS | 0.95 | vehiclehistory.gov | **Yes** | Federal title database. Requires approved provider status. |
| `state-dmv-california` | California DMV | 0.95 | dmv.ca.gov | **Yes** | Template for state DMV integrations. |
| `wayback-machine` | Internet Archive | 0.95 | web.archive.org | No | Historical page snapshots. Extremely reliable for provenance. |
| `google-cache` | Google Cache | 0.90 | webcache.googleusercontent.com | No | Recent snapshots of recently-removed listings. |
| `insurance-claims-generic` | Insurance Claim Data | 0.90 | — | **Yes** | Through LexisNexis/Verisk. Expensive but valuable. |
| `356-registry` | 356 Registry | 0.90 | 356registry.org | No | Porsche 356 production database. |
| `fca-registry` | Ferrari Club of America | 0.90 | ferrariclubofamerica.org | No | FCA member registry. |
| `hemi-registry` | 426 Hemi Registry | 0.90 | thehemi.com | No | Registry of 426 Hemi powered vehicles. |
| `mopar-sunroof-registry` | Mopar Sunroof Registry | 0.90 | moparsunroofregistry.com | No | Factory sunroof Mopars. |
| `pca-registry` | Porsche Club of America | 0.90 | pca.org | No | PCA member vehicle registry. |
| `porsche-register` | Porsche Register | 0.92 | porscheregister.com | No | 356 Speedster and other Porsche registries. |
| `hamtramck-historical` | Hamtramck Historical | 0.92 | hamtramck-historical.com | No | Historical Dodge/Plymouth production data. |
| `70-roadrunner-gtx-registry` | 1970 Road Runner/GTX Registry | 0.88 | 70rr-gtxregistry.iwarp.com | No | 1970 Plymouth B-body registry. |
| `71-plymouth-bbody-registry` | 1971 Plymouth B-Body Registry | 0.88 | 71plymouthbbodyregistry.weebly.com | No | 1971 Plymouth production registry. |
| `1970-roadrunner` | 1970 Road Runner Registry | 0.85 | 1970roadrunner.com | No | Dedicated 1970 Road Runner documentation. |
| `hagerty-valuation` | Hagerty Valuation Tools | 0.85 | hagerty.com/valuation-tools | No | Market values and trends. |
| `sports-car-market` | Sports Car Market | 0.85 | sportscarmarket.com | No | Auction results analysis. |
| `exclusive-car-registry` | Exclusive Car Registry | 0.85 | exclusivecarregistry.com | No | Dealers, collections, auction houses database. Slug alias: 'ecr'. |

---

## Forum Sources (11)

| Slug | Name | Trust | Base URL | Notes |
|------|------|------:|----------|-------|
| `fb-group-squarebody-73-87` | Chevy/GMC Squarebody 73-87 (FB Group) | 0.70 | facebook.com/groups/328305202250392/ | High volume enthusiast community. |
| `forum-builds` | Forum Build Threads | 0.70 | — | Aggregated build thread data. |
| `rennlist` | Rennlist Forums | 0.60 | rennlist.com | Porsche community. |
| `pelican-parts` | Pelican Parts Forums | 0.60 | forums.pelicanparts.com | Porsche parts and community. |
| `355nation` | 355nation | 0.50 | — | — |
| `broncozone` | broncozone | 0.50 | — | — |
| `camaros` | camaros | 0.50 | — | — |
| `camaros-net` | camaros-net | 0.50 | — | — |
| `gmfullsize` | gmfullsize | 0.50 | — | — |
| `mazdas247` | mazdas247 | 0.50 | — | — |
| `nastyz28` | nastyz28 | 0.50 | — | — |
| `thetruckstop` | thetruckstop | 0.50 | — | — |

---

## Social Media Sources (11)

| Slug | Name | Trust | Notes |
|------|------|------:|-------|
| `youtube` | YouTube | 0.50 | Video content, build documentation. |
| `petrolicious` | Petrolicious | 0.50 | Premium automotive storytelling. |
| `facebook-groups` | Facebook Groups | 0.45 | Enthusiast communities. |
| `hiconsumption` | HiConsumption | 0.40 | Lifestyle/auto content. |
| `instagram` | Instagram | 0.40 | Photo-heavy, low structured data. |
| `reddit` | Reddit | 0.40 | Community discussions. |
| `thedrive` | The Drive | 0.40 | Automotive journalism. |
| `uncrate` | Uncrate | 0.40 | Lifestyle content. |
| `facebook-vehicle-pages` | Facebook Vehicle Pages (Reposters) | 0.30 | Low-trust repost pages. |
| `twitter` | X/Twitter | 0.30 | Short-form, low structured data. |
| `tiktok` | TikTok | 0.25 | Video, minimal structured data. |

---

## Shop / Builder Sources (10)

| Slug | Name | Trust | Base URL | Notes |
|------|------|------:|----------|-------|
| `gunther-werks` | Gunther Werks | 0.90 | guntherwerks.com | 993 restomods. ~75 units built. |
| `arkonik` | Arkonik | 0.85 | arkonik.com | Land Rover Defender specialist. |
| `east-coast-defender` | East Coast Defender | 0.85 | eastcoastdefender.com | Defender restomods. |
| `gateway-bronco` | Gateway Bronco | 0.85 | gatewaybronco.com | Classic Ford Bronco specialist. |
| `icon-4x4` | ICON 4x4 | 0.85 | icon4x4.com | Land Cruiser, Bronco restomods. |
| `kindred-motorworks` | Kindred Motorworks | 0.85 | kindredmotorworks.com | Classic trucks and Broncos. |
| `legacy-classic-trucks` | Legacy Classic Trucks | 0.85 | legacyclassictrucks.com | Power Wagon, classic truck restomods. |
| `ringbrothers` | Ringbrothers | 0.85 | ringbrothers.com | Pro-touring muscle cars, SEMA builds. |
| `roadster-shop` | Roadster Shop | 0.85 | roadstershop.com | Pro-touring chassis and builds. |
| `velocity-restorations` | Velocity Restorations | 0.85 | velocityrestorations.com | Classic Bronco, Defender builds. |

---

## Dealer Sources (14)

| Slug | Name | Trust | Base URL |
|------|------|------:|----------|
| `grand-prix-classics` | Grand Prix Classics | 0.75 | grandprixclassics.com/inventory/cars |
| `ilusso` | iLusso | 0.70 | ilusso.com |
| `legendary-motorcar` | Legendary Motorcar | 0.70 | legendarymotorcar.com |
| `art-and-speed` | Art & Speed Classic Car Gallery | 0.65 | artandspeed.com/vehicles |
| `classic-auto-mall` | Classic Auto Mall | 0.65 | classicautomall.com/vehicles |
| `er-classics` | ER Classics | 0.65 | erclassics.com |
| `erclassics` | ER Classics (duplicate slug) | 0.65 | — |
| `gateway-classic-cars` | Gateway Classic Cars | 0.65 | gatewayclassiccars.com |
| `global-autosports` | Global Autosports | 0.65 | globalautosports.com |
| `motorenn` | Motorenn | 0.65 | motorenn.com |
| `streetside-classics` | Streetside Classics | 0.65 | streetsideclassics.com |
| `vanguard-motor-sales` | Vanguard Motor Sales | 0.65 | vanguardmotorsales.com |
| `volo-auto-museum` | Volo Auto Museum | 0.65 | volocars.com |
| `high-octane-classics` | High Octane Classics | 0.60 | highoctaneclassics.com |
| `rock-solid-motorsports` | Rock Solid Motorsports | 0.60 | rocksolidmotorsportsinc.com |
| `southern-motors` | Southern Motors | 0.60 | southernmotors.com |

---

## Owner / First-Party Sources (6)

These are the highest-trust sources because they come directly from the vehicle owner.

| Slug | Name | Trust | Notes |
|------|------|------:|-------|
| `iphoto` | Apple Photos / iPhoto | 1.00 | Photos library. osxphotos CLI. Source ID: `09cc8ecb-d268-4979-9e8d-ab1b680d54a2`. |
| `imessage` | iMessage | 1.00 | Text threads with buyers/sellers. Local `chat.db` access. |
| `desktop_archive` | Desktop Projects Archive | 0.95 | Local project files. |
| `email_receipt` | Email Order Receipt | 0.95 | Amazon, parts vendor receipts via Gmail mining. |
| `claude-extension` | Claude Extension (User Contributed) | 0.80 | Observations via Nuke Claude Desktop extension. Human-validated. |
| `owner-input` | Owner Input | 0.70 | Direct owner data entry. |

---

## Internal / AI Pipeline Sources (8)

| Slug | Name | Trust | Notes |
|------|------|------:|-------|
| `part_number_ocr` | Part Number OCR | 0.80 | OCR extraction from part number photos. |
| `receipt_ocr` | Receipt OCR | 0.75 | OCR extraction from receipt photos. |
| `photo_pipeline` | Photo Pipeline (AI Vision) | 0.70 | AI vision classification of vehicle photos. |
| `conceptcarz` | ConceptCarz | 0.70 | Vehicle reference data. 237K vehicles. |
| `ai-description-extraction` | AI Description Extraction | 0.65 | LLM extraction from listing descriptions. |
| `nuke-vision` | Nuke Vision Pipeline | 0.65 | Combined vision pipeline. |
| `newsletter_intelligence` | Newsletter Intelligence | 0.60 | Extraction from automotive newsletters. |
| `internal-inference` | System Inference | 0.50 | Platform-generated inferences. |
| `external-agent-polsia` | Polsia External Agent | 0.40 | External agent contributions. |

---

## Aggregator Sources (3)

| Slug | Name | Trust | Base URL | Notes |
|------|------|------:|----------|-------|
| `jamesedition` | JamesEdition | 0.70 | jamesedition.com/cars | 1.3K vehicles. Multi-dealer aggregator. |
| `carfax-competitor-analysis` | Carfax (Competitor Reference) | 0.70 | carfax.com | Not a data source. Competitive analysis reference only. |
| `classic-com` | Classic.com | 0.65 | classic.com | Aggregates from 275+ dealers. Good for VIN discovery. Data passthrough only. |

---

## Documentation Sources (1)

| Slug | Name | Trust | Notes |
|------|------|------:|-------|
| `deal-jacket-ocr` | Deal Jacket OCR Pipeline | 0.70 | OCR from physical deal jackets (titles, registrations, etc). |

---

## Museum Sources (1)

| Slug | Name | Trust | Base URL |
|------|------|------:|----------|
| `audrain-museum` | Audrain Automobile Museum | 0.80 | audrainautomuseum.org |

---

## Known Issues

1. **Duplicate slugs:** `broad-arrow` / `broad_arrow`, `cars-and-bids` / `cars_and_bids`, `classicdriver` / `classic-driver`, `er-classics` / `erclassics`. Should be consolidated.
2. **Missing base_url:** Many sources (especially forums and social media) have NULL base_url.
3. **No rate_limit_per_hour set:** Only `autotrader-classics` has a rate limit configured (0, meaning blocked). Most sources have NULL.
4. **No status column:** The `observation_sources` table has no `status` column. Active/inactive/blocked status is tracked only in the `notes` field.

---

## How to Refresh This Registry

```sql
SELECT slug, display_name, category, base_trust_score, base_url,
       rate_limit_per_hour, requires_auth, notes
FROM observation_sources
ORDER BY category, slug;
```

To add a new source:
```sql
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, base_url, requires_auth, notes)
VALUES ('new-source', 'New Source Name', 'auction', 0.70, 'https://newsource.com', false, 'Description');
```
