# Live Auction Platform Protocol Analysis

## Overview

This document tracks the real-time communication protocols used by each auction platform, enabling us to build efficient sync adapters that feel "live" to users.

## Protocol Priority

For optimal user experience, we prioritize data sources in this order:
1. **WebSocket** - Best. True real-time, bidirectional.
2. **Server-Sent Events (SSE)** - Good. Server push, lightweight.
3. **Long Polling** - Acceptable. Simulates real-time with HTTP.
4. **Interval Polling** - Fallback. Regular HTTP requests.

---

## Tier 1: Online-First Platforms (High Priority)

### 1. Bring a Trailer (BaT)
**Status**: Adapter exists, needs WebSocket analysis

| Aspect | Details |
|--------|---------|
| Base URL | https://bringatrailer.com |
| Auth | WordPress session cookies (`wordpress_logged_in_*`) |
| Current Method | HTML scraping via polling |
| Soft Close | 2 minutes |
| Rate Limit | ~20 req/min recommended |

**Known Endpoints:**
- Auction page: `/listing/{slug}`
- Bid submission: `/wp-admin/admin-ajax.php` (POST with CSRF)
- My Bids: `/my-bids/`

**To Investigate:**
- [ ] Open browser dev tools on active auction, monitor WebSocket connections
- [ ] Check for `wss://` connections in Network tab
- [ ] Look for Pusher, Socket.io, or custom WS implementations
- [ ] Analyze bid submission response for real-time update mechanism
- [ ] Check for polling intervals in JavaScript source

**Anti-Bot Measures:**
- CSRF tokens required for bids
- Session validation on protected endpoints
- May use Cloudflare or similar CDN protection

---

### 2. Cars & Bids
**Status**: No adapter yet, similar to BaT

| Aspect | Details |
|--------|---------|
| Base URL | https://carsandbids.com |
| Auth | Session-based (TBD) |
| Current Method | Not implemented |
| Soft Close | Yes (duration TBD) |
| Notable | Has mobile app with push notifications |

**Known Features:**
- Live bidding bar with countdown timer
- Live chat feature (unique among auction sites)
- Push notifications when outbid

**To Investigate:**
- [ ] Technology stack (check BuiltWith, Wappalyzer)
- [ ] WebSocket/SSE for live bid updates
- [ ] Chat implementation (likely WebSocket)
- [ ] API structure for mobile app (may be reusable)
- [ ] Authentication flow

---

### 3. PCARMARKET
**Status**: Have extractor, need real-time sync

| Aspect | Details |
|--------|---------|
| Base URL | https://pcarmarket.com |
| Focus | Porsche and collectible vehicles |
| Current Method | Polling via extractor |
| Community | Very engaged, active comments |

**To Investigate:**
- [ ] Real-time bid update mechanism
- [ ] Comment notification system
- [ ] Authentication requirements for bidding

---

### 4. Collecting Cars
**Status**: Have monitor script, need adapter

| Aspect | Details |
|--------|---------|
| Base URL | https://collectingcars.com |
| Location | UK-based, 24/7 global |
| Current Method | Basic monitoring script exists |

**To Investigate:**
- [ ] Real-time implementation (likely modern, UK startup)
- [ ] API availability
- [ ] Authentication for international bidding

---

### 5. Hagerty Marketplace
**Status**: Have extractor

| Aspect | Details |
|--------|---------|
| Base URL | https://www.hagerty.com/marketplace |
| Soft Close | 2 minutes (confirmed) |
| Community | 1.8M Hagerty members |
| Ecosystem | Sister company to Broad Arrow |

**To Investigate:**
- [ ] Shared infrastructure with Broad Arrow?
- [ ] Hagerty account integration for bidding
- [ ] Real-time update mechanism

---

## Tier 2: Live Event + Online (Medium Priority)

### 6. Mecum Auctions
**Status**: Needs full analysis

| Aspect | Details |
|--------|---------|
| Base URL | https://www.mecum.com |
| Format | Live events with online bidding |
| Volume | Largest by number of vehicles |
| Events | Kissimmee, Indianapolis, Monterey |

**Key Challenge:**
Live event auctions have different timing - vehicles go across the block in sequence, not timed auctions. Need to understand:
- How online bidders connect to live stream
- How bid submission works during live auction
- Delay/latency in online bidding

**To Investigate:**
- [ ] Online bidding registration process
- [ ] Live auction streaming technology
- [ ] Real-time bid integration
- [ ] Pre-auction vs live-auction data access

---

### 7. Barrett-Jackson
**Status**: Needs full analysis

| Aspect | Details |
|--------|---------|
| Base URL | https://www.barrett-jackson.com |
| Format | Live events, No Reserve policy |
| Media | TV broadcasts (major differentiator) |

**Key Challenge:**
Similar to Mecum - live events with online bidding. May have:
- Streaming video integration
- Synchronized bid display with TV
- Premium online bidding registration

**To Investigate:**
- [ ] Online bidding platform architecture
- [ ] TV sync technology
- [ ] API availability for results

---

### 8. RM Sotheby's
**Status**: Needs analysis

| Aspect | Details |
|--------|---------|
| Base URL | https://rmsothebys.com |
| Format | Mix of live and online-only |
| Value | Highest value sales in industry |

**To Investigate:**
- [ ] Online-only auction implementation
- [ ] Live auction online bidding
- [ ] Authentication for high-value bidding

---

### 9. Bonhams
**Status**: Has 24/7 online capability

| Aspect | Details |
|--------|---------|
| Base URL | https://www.bonhams.com |
| Online | carsonline.bonhams.com for 24/7 auctions |
| Format | Hybrid (live + online-only) |

**Notable:**
- Separate online platform may have different tech stack
- 24/7 online suggests modern real-time implementation

**To Investigate:**
- [ ] carsonline.bonhams.com tech stack
- [ ] Real-time bidding mechanism
- [ ] Integration with main Bonhams platform

---

### 10. Broad Arrow Auctions
**Status**: Growing, Hagerty company

| Aspect | Details |
|--------|---------|
| Base URL | https://broadarrowauctions.com |
| Format | Online + live events |
| Parent | Hagerty (may share infrastructure) |

**To Investigate:**
- [ ] Shared tech with Hagerty Marketplace
- [ ] Multi-location online sale implementation

---

## Common Patterns to Look For

### WebSocket Indicators
```javascript
// Look for these in page source / network tab
new WebSocket('wss://...')
Pusher.subscribe(...)
io.connect(...)  // Socket.io
ActionCable  // Rails
Phoenix.Socket  // Elixir Phoenix
```

### Polling Indicators
```javascript
// Common polling patterns
setInterval(() => fetch('/api/auction/...'), 5000)
$.ajax({ url: '/update', ... })
```

### SSE Indicators
```javascript
new EventSource('/stream/...')
```

---

## Reverse Engineering Methodology

### Step 1: Browser Dev Tools Analysis
1. Open auction page in Chrome/Firefox
2. Open Network tab, filter by WS (WebSocket)
3. Filter by XHR to see polling endpoints
4. Filter by EventStream for SSE
5. Monitor during bid activity if possible

### Step 2: JavaScript Analysis
1. View page source, look for bundled JS
2. Search for WebSocket, Pusher, Socket.io
3. Find API endpoint patterns
4. Identify authentication tokens

### Step 3: Mobile App Analysis (if available)
1. Proxy mobile traffic (Charles, mitmproxy)
2. Often uses cleaner REST/WebSocket APIs
3. May have less anti-bot protection

### Step 4: API Endpoint Documentation
Document all discovered endpoints:
- URL pattern
- HTTP method
- Required headers
- Request/response format
- Rate limits observed

---

## Anti-Blocking Strategies

### Session Management
- Rotate sessions before they expire
- Use session pool with health checking
- Implement 2FA handling where required

### Request Patterns
- Randomize timing slightly (±10%)
- Vary User-Agent pool
- Respect rate limits with backoff

### Proxy Infrastructure
- Residential proxies for scraping
- Datacenter IPs may be blocked
- Geographic distribution for redundancy

### Fingerprint Evasion
- Browser-like headers
- Realistic cookie handling
- JavaScript rendering when needed (Playwright)

---

## Next Steps

1. **Immediate**: Analyze BaT with browser dev tools during live auction
2. **This Week**: Build Cars & Bids adapter skeleton
3. **Ongoing**: Document each platform as analyzed
4. **Infrastructure**: Set up proxy pool for resilient syncing

---

## Resources

- [Apify BaT Scraper](https://apify.com/parseforge/bringatrailer-auctions-scraper) - Commercial scraper reference
- Existing BaT adapter: `/nuke_api/lib/nuke_api/bidding/platforms/bat.ex`
- Sync coordinator: `/nuke_api/lib/nuke_api/bidding/auction_sync_coordinator.ex`
