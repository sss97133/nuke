# Contact Expansion Plan

Systematic approach to building a database of 10,000+ classic car enthusiast contacts.

## Current Status
- **14 contacts** (CCCA regional directors)
- Method: Hardcoded from manual research

## Target: 10,000 Contacts

| Source Category | Est. Contacts | Method | Priority |
|-----------------|---------------|--------|----------|
| Car Club Officers | 2,000+ | Manual + Import | P0 |
| Restoration Shops | 2,000+ | Scrape (public) | P0 |
| Event Organizers | 500+ | Manual + Scrape | P1 |
| Content Creators | 1,000+ | Scrape (public) | P1 |
| Forum Power Users | 3,000+ | Scrape w/ care | P2 |
| Our Platform Sellers | 1,000+ | Internal data | P2 |

---

## Phase 1: Low-Hanging Fruit (Week 1)

### 1.1 Expand Club Officers (Manual Research)
Each club has 10-50 regional officers with public contact info.

**Action:** Spend 2-3 hours manually collecting from each site, add to `import-contacts.js`:

| Club | URL | Est. Contacts | Status |
|------|-----|---------------|--------|
| CCCA | classiccarclub.org/regional-clubs | 50 | ✓ Done (14) |
| AACA | aaca.org/about-aaca/our-regions | 200+ | TODO |
| PCA | pca.org/regions → individual pages | 150+ | TODO |
| VMCCA | vmcca.org/chapters | 50+ | TODO |
| HCCA | hcca.org/sections | 40+ | TODO |
| NCRS | ncrs.org/chapters | 100+ | TODO |
| FCA | ferrariclubofamerica.org/regions | 30+ | TODO |
| MCA | mustang.org/regional-clubs | 100+ | TODO |

**Script:** `dotenvx run -- node scripts/contacts/import-contacts.js clubs all`

### 1.2 YouTube Channels (Scrapable)
Car channels often have business email in "About" section.

**Target channels (10k+ subs):**
- Doug DeMuro, Hoovies Garage, VINwiki, Tavarish, ChrisFix
- Barn Find Hunter, Jay Leno's Garage, Hagerty
- Petrolicious, Hoonigan, The Smoking Tire

**Action:** Create `extract-youtube-channels.js` using YouTube Data API:
```bash
# Get channel info including email
GET https://www.googleapis.com/youtube/v3/channels?part=snippet,brandingSettings&id={channelId}
```

### 1.3 Business Directories (Public)
Restoration shops WANT inquiries.

**Scrapable sources:**
- Classic.com dealer directory
- Hagerty shop finder
- Hemmings (individual dealer pages, not directory)
- State-specific classic car business registries

---

## Phase 2: Event-Based (Week 2-3)

### 2.1 Concours d'Elegance Participants
Many concours publish entrant/judge lists.

**Sources:**
- Pebble Beach: pebblebeachconcours.net/past-events
- Amelia Island: ameliaconcours.com
- The Quail: signatureevents.peninsula.com
- Greenwich: greenwichconcours.com

**Method:** Manual collection from PDF programs, news articles

### 2.2 Car Show Registrations
Regional car shows often publish participant lists.

**Action:** Google "[region] car show results [year]" and extract from:
- News articles
- Club newsletters
- Event websites

---

## Phase 3: Forum Mining (Week 3-4)

### 3.1 Forum Power User Extraction
Focus on users with high post counts who list email/contact info in signatures.

**Target forums:**
| Forum | Focus | Approach |
|-------|-------|----------|
| Rennlist | Porsche | Profile pages (requires strategy) |
| FerrariChat | Ferrari | Marketplace sellers |
| TheSamba | VW/Porsche | Classified posters |
| Pelican Parts | Porsche/BMW | Tech contributors |
| Corvette Forum | Corvette | Active classifieds |

**Extraction criteria:**
- 500+ posts
- Active in last year
- Has public profile with contact info

### 3.2 Marketplace Seller Mining
Forum classified sections have seller contact info.

**Action:** Scrape classified listings for seller contact info from:
- TheSamba.com classifieds
- Bring a Trailer seller profiles
- Cars and Bids seller info

---

## Phase 4: Content Creator Outreach (Week 4+)

### 4.1 Instagram Car Accounts
Business accounts have contact buttons.

**Method:** Search hashtags (#classiccars, #vintagecars, #barnfind) and extract:
- Account name
- Follower count
- Contact email (if business account)

### 4.2 Classic Car Bloggers
Many enthusiast blogs have contact pages.

**Action:** Google search + manual collection:
- "[make] blog contact"
- "classic car restoration blog"
- "barn find blog"

---

## Automation Scripts

### Current Scripts
```
scripts/contacts/
├── contact-utils.js           # Shared utilities
├── import-contacts.js         # Manual/CSV/JSON import
├── extract-car-club.js        # Generic club extractor (limited use)
├── extract-car-club-v2.js     # Improved extractor
├── extract-hemmings-directory.js
├── contact-discovery-runner.sh
└── contact-stats.sh
```

### Needed Scripts
```
TODO:
├── extract-youtube-channels.js  # YouTube API
├── extract-instagram-business.js # Instagram Graph API
├── extract-forum-sellers.js     # TheSamba, etc.
├── validate-emails.js           # Email verification
└── enrich-contacts.js           # Add LinkedIn, etc.
```

---

## Quality Pipeline

### Stage 1: Raw Import
- `status: 'pending'`
- Has email, minimal info

### Stage 2: Validation
- Verify email deliverability (use service like ZeroBounce)
- Remove bounced/invalid
- `status: 'validated'` or `status: 'invalid'`

### Stage 3: Enrichment
- Add LinkedIn profile
- Add business info
- Add vehicle interests (if known)
- `enriched: true`

### Stage 4: Ready for Outreach
- `status: 'ready'`
- Has: valid email, name, organization
- Queue for cold contact sequence

---

## Weekly Goals

| Week | Goal | Expected Contacts |
|------|------|-------------------|
| 1 | Club officers + YouTube | +500 |
| 2 | Business directories | +1,000 |
| 3 | Concours participants | +500 |
| 4 | Forum sellers | +1,000 |
| 5 | Validation + enrichment | Quality pass |
| 6+ | Ongoing expansion | +500/week |

---

## Commands

```bash
# Import hardcoded club contacts
dotenvx run -- node scripts/contacts/import-contacts.js clubs all

# Check stats
./scripts/contacts/contact-stats.sh

# Run automated discovery (limited due to blocking)
./scripts/contacts/contact-discovery-runner.sh 2

# Query contacts
dotenvx run -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/discovery_leads?lead_type=eq.person&select=count" ...'
```

---

## Notes

- **Always respect robots.txt and rate limits**
- **Focus on people who WANT to be contacted** (businesses, content creators)
- **Quality over quantity** - 1,000 validated contacts > 10,000 garbage emails
- **Manual research is valuable** - 2 hours of careful collection beats hours of blocked scraping
