# Contact Discovery Factory

Systematic extraction of classic car collector/enthusiast contacts for cold outreach.

## Reality Check

**Most major car clubs (PCA, AACA, CCCA, etc.) protect member contact info:**
- Blocked by auth walls
- Rate limited / bot detection
- Only show generic org emails

**What DOES work:**
1. **Manual Research** → Copy from public pages, store in import lists
2. **Business Directories** → Shops/dealers WANT to be contacted
3. **Content Creators** → YouTube/blogs have public contact info
4. **Event Participants** → Some concours publish judge lists
5. **Our Own Data** → BaT sellers, forum posters in scraped content

## The Pattern (Rinse & Repeat)

```
1. IDENTIFY SOURCE    → Find directory/roster page with contact info
2. TEST ACCESSIBILITY → Can we actually scrape it? (many block bots)
3. CHOOSE METHOD      → Scrape (if possible) OR Manual collection
4. BUILD EXTRACTOR    → Script OR hardcoded list in import-contacts.js
5. RUN EXTRACTION     → Execute with rate limiting
6. STORE AS LEADS     → Save to discovery_leads (lead_type: 'person')
7. VALIDATE & ENRICH  → Verify emails, add LinkedIn, etc.
8. QUEUE FOR OUTREACH → Mark as ready for cold contact
```

## Data Schema

All contacts go to `discovery_leads` table:

```typescript
interface ContactLead {
  lead_type: 'person';
  lead_name: string;           // "CCCA Wisconsin Director"
  lead_url: string;            // "mailto:email@example.com"
  lead_description: string;    // Full context
  discovered_from_url: string; // Source page
  discovery_method: 'web_scrape';
  confidence_score: number;    // 0.0-1.0
  status: 'pending' | 'validated' | 'invalid' | 'converted';
  raw_data: {
    name?: string;
    email: string;
    phone?: string;
    role?: string;
    region?: string;
    organization?: string;
    source: string;
    // Platform-specific fields
    forum_posts?: number;
    member_since?: string;
    vehicles_owned?: string[];
  };
}
```

## Source Priority Queue

### Tier 1: Club Officer Directories (Structured, High-Value)
| Source | URL Pattern | Est. Contacts | Priority |
|--------|-------------|---------------|----------|
| AACA Regions | aaca.org/regions | 800+ | P0 |
| PCA Regions | pca.org/regions | 600+ | P0 |
| VMCCA Chapters | vmcca.org/chapters | 200+ | P1 |
| HCCA Sections | hcca.org/sections | 150+ | P1 |
| Ferrari Club | ferrariclubofamerica.org | 100+ | P1 |
| Corvette Clubs | nccc.org/clubs | 300+ | P1 |
| Mustang Club | mustang.org/regions | 200+ | P1 |
| Model A Ford | mafca.com/chapters | 250+ | P1 |
| Packard Club | packardclub.org/regions | 100+ | P2 |
| Pierce-Arrow | pierce-arrow.org | 50+ | P2 |
| Auburn-Cord | acdclub.org/regions | 75+ | P2 |
| Stutz Club | stutzclub.org | 50+ | P2 |

### Tier 2: Business Directories (Shops, Dealers, Services)
| Source | URL Pattern | Est. Contacts | Priority |
|--------|-------------|---------------|----------|
| Hemmings Directory | hemmings.com/business-directory | 3,000+ | P0 |
| Classic.com Dealers | classic.com/dealers | 500+ | P1 |
| Hagerty Shops | hagerty.com/shop-finder | 1,000+ | P1 |
| SCCA Pro Shops | scca.com | 200+ | P2 |

### Tier 3: Forum Power Users (High Engagement)
| Source | Criteria | Est. Contacts | Priority |
|--------|----------|---------------|----------|
| Rennlist | 1000+ posts | 2,000+ | P1 |
| FerrariChat | 500+ posts | 1,000+ | P1 |
| Pelican Parts | 1000+ posts | 1,500+ | P1 |
| Hemmings Forums | Active sellers | 500+ | P2 |
| TheSamba (VW) | 500+ posts | 1,000+ | P2 |
| Corvette Forum | 1000+ posts | 2,000+ | P2 |

### Tier 4: Event Participants
| Source | Type | Est. Contacts | Priority |
|--------|------|---------------|----------|
| Pebble Beach | Judges, entrants | 500+ | P1 |
| Amelia Island | Judges, entrants | 400+ | P1 |
| AACA National Shows | Award winners | 1,000+ | P2 |
| Concours listings | Organizers | 500+ | P2 |

### Tier 5: Content Creators
| Source | Type | Est. Contacts | Priority |
|--------|------|---------------|----------|
| YouTube | Car channels 10k+ subs | 500+ | P2 |
| Instagram | Car accounts 5k+ followers | 2,000+ | P3 |
| Blogs | Active classic car blogs | 200+ | P3 |

## Extraction Scripts

Each source gets a script in `/Users/skylar/nuke/scripts/contacts/`:

```
contacts/
├── extract-aaca-regions.js
├── extract-pca-regions.js
├── extract-hemmings-directory.js
├── extract-forum-powerusers.js
├── contact-discovery-runner.sh   # Orchestrates all
└── README.md
```

## Automation

### Daily Cron Job
```bash
# Run nightly at 2 AM - extract from 2-3 sources
0 2 * * * /Users/skylar/nuke/scripts/contacts/contact-discovery-runner.sh
```

### Runner Logic
1. Check which sources haven't been scraped recently
2. Pick 2-3 sources based on priority
3. Run extraction with rate limiting
4. Log results
5. Send summary notification

## Quality Metrics

- **Valid Email Rate**: Target >80%
- **Duplicate Rate**: Target <5%
- **Enrichment Rate**: Target >50% (LinkedIn, phone, etc.)

## Commands

```bash
# Run single source extraction
node scripts/contacts/extract-aaca-regions.js

# Run full discovery cycle
./scripts/contacts/contact-discovery-runner.sh

# Check discovery stats
dotenvx run -- curl "$VITE_SUPABASE_URL/rest/v1/discovery_leads?lead_type=eq.person&select=count"
```
