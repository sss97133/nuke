# Facebook Marketplace Scraper Landscape Analysis

## Executive Summary

Facebook Marketplace scraping is technically challenging due to aggressive anti-bot measures, dynamic JavaScript rendering, and lack of official API support. Three main approaches exist:

1. **Browser Automation** (Playwright/Puppeteer/Selenium) - Most common, moderate difficulty
2. **GraphQL API Interception** - Higher technical complexity, potentially more efficient
3. **Commercial Solutions** (Apify) - Easiest but ongoing costs

**BREAKTHROUGH UPDATE (2026-02-04):** Using Bingbot/Googlebot user agent bypasses authentication entirely! Facebook serves full listing data to search engine bots for SEO. This is now our primary approach.

---

## Approach 0: Bot User Agent (RECOMMENDED - NEW DISCOVERY)

### The Discovery

Facebook serves full marketplace listing data to search engine crawlers for SEO purposes. No authentication required.

**Working User Agents:**
- `Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)`
- `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`

**Data Available:**
- `marketplace_listing_title` - full listing title
- `amount_with_offset_in_currency` - price in cents
- Listing IDs for direct URLs
- ~24 listings per page

**Implementation:**
```typescript
const response = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    Accept: "text/html",
  },
});
```

**Pros:** No auth, no proxies needed, simple implementation, high reliability
**Cons:** May get rate limited at scale, Facebook could detect pattern

---

## Approach 1: Browser Automation

### Technology Options

| Tool | Language | Pros | Cons |
|------|----------|------|------|
| **Playwright** | Python/Node.js | Modern, fastest, best stealth | Newer ecosystem |
| **Puppeteer** | Node.js | Mature, Chrome-native | Node.js only |
| **Selenium** | Python/Java/etc | Most mature, wide language support | Slower, easier to detect |

### Key Implementation Details

**Core Stack:**
- Playwright or Puppeteer for browser control
- BeautifulSoup or Cheerio for HTML parsing
- Residential proxy service for IP rotation
- Stealth plugins to mask automation detection

**Anti-Bot Evasion Techniques:**
- `--disable-blink-features=AutomationControlled` browser flag
- WebDriver property masking via JavaScript injection
- Realistic timing delays (3-7 seconds between requests)
- Mobile/residential proxies (Facebook trusts these far more than datacenter IPs)
- Windows user-agent spoofing
- Cookie-based session persistence

### Data Fields Extractable
- Listing title, description, price, condition, category
- Multiple images via carousel navigation
- Location (city, state, coordinates)
- Seller info (name, profile link, seller type)
- Post date, listing URL, listing ID

### Open-Source Implementations

1. **[passivebot/facebook-marketplace-scraper](https://github.com/passivebot/facebook-marketplace-scraper)** - Python, Playwright, BeautifulSoup, Streamlit GUI. Archived November 2024.

2. **[dataartist-og/facebook-marketplace-scraper](https://github.com/dataartist-og/facebook-marketplace-scraper)** - Python, Selenium, SQLite, PyQt5 GUI.

3. **[Facebook-Marketplace-Selenium.py](https://gist.github.com/Kiwibp/78cf224a0a5d0c2c33fdb371b8ebdb93)** - Full login flow, MongoDB storage, image carousel scraping across 7 categories.

4. **[awesome-facebook-scrapers](https://github.com/The-Web-Scraping-Playbook/awesome-facebook-scrapers)** - Curated list of Facebook scrapers with maintenance status.

**Difficulty:** 9/10 (Hard) - High maintenance due to frequent DOM changes.

---

## Approach 2: GraphQL API Interception

### Technical Details

**Endpoint:** `https://www.facebook.com/api/graphql/`

**Response Structure:** `data > marketplace_search > feed_units > edges > node > listing`

**Data Available:** Listing ID, title, price (current/previous), images, city, state, seller ID/name, vehicle mileage, video links.

### Implementation

Two approaches:
1. **HAR File Capture:** Manual browsing with DevTools recording, then parse GraphQL requests. Not scalable but works without automation detection.

2. **Request Replay:** Capture authenticated GraphQL requests with all headers/cookies, replay programmatically with modified parameters.

### Open-Source Implementations

- **[kyleronayne/marketplace-api](https://github.com/kyleronayne/marketplace-api)** - Python wrapper for Facebook GraphQL API. No authentication required for basic searches.

- **[Wes Bos GraphQL Gist](https://gist.github.com/wesbos/4d05bcc6aac16866259e818de1d1c4ad)** - JavaScript implementation with doc_id `2022753507811174`.

**Challenges:** Undocumented API, persisted query hashes can change, requires valid session cookies for full access.

---

## Approach 3: Commercial Solutions (Apify)

### Available Scrapers

- **[apify/facebook-marketplace-scraper](https://apify.com/apify/facebook-marketplace-scraper)** - Official Apify scraper using PlaywrightCrawler
- **[curious_coder/facebook-marketplace](https://apify.com/curious_coder/facebook-marketplace)**
- **[happitap/facebook-marketplace-listings-scraper](https://apify.com/happitap/facebook-marketplace-listings-scraper)** - Fast card-based scraping with optional detail pages

### Pricing

| Plan | Monthly Cost | Notes |
|------|-------------|-------|
| Free | $0 | $5 credits |
| Starter | $39 | 32GB memory, 14-day retention |
| Scale | $199 | $0.25/compute unit |
| Business | ~$1,000 | 256GB memory, priority support |

**Pros:** No infrastructure management, built-in anti-bot handling, API access
**Cons:** Ongoing costs, less control, data through third party

---

## Anti-Bot Detection Summary

Facebook uses:
- IP reputation (datacenter IPs flagged)
- Browser/device fingerprinting
- Behavioral analysis (timing, mouse movements)
- CAPTCHA challenges
- Session/token validation

**Best Bypass Strategies:**
1. Bot user agent (Bingbot/Googlebot) - NEW DISCOVERY
2. Mobile/residential proxies (high effectiveness)
3. Puppeteer stealth plugin
4. Cookie/session persistence
5. Human-like timing (3-7 sec delays)

---

## Recommendation for Nuke Platform

**Primary Approach: Bot User Agent (Simple Fetch)**

This is the new discovery - Facebook serves full data to search engine bots. Start here.

**Fallback: Playwright + Residential Proxies**

If bot approach gets blocked at scale.

**Implementation Phases:**
1. Deploy bot-based scraper (already built)
2. Monitor for rate limiting or blocks
3. If needed, add Playwright fallback with stealth configuration
4. Scale with parallel instances

---

## Key Sources

- [Scrapfly: How to Scrape Facebook](https://scrapfly.io/blog/posts/how-to-scrape-facebook)
- [ScrapeOps: Facebook Scraping Teardown](https://scrapeops.io/websites/facebook/)
- [Coronium: Facebook Scraper Python Guide](https://www.coronium.io/blog/facebook-scraper-python)
- [Building an LLM-powered Facebook Marketplace Bot](https://dev.to/isaacaddis/building-an-llm-powered-facebook-marketplace-bot-2o54)
- [Stevesie No-Code FB Marketplace Scraper](https://stevesie.com/apps/facebook-api/scrape/marketplace)
- [Apify Facebook Marketplace Scraper](https://apify.com/apify/facebook-marketplace-scraper)
