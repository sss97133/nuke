# Facebook Marketplace Playwright Scraper Notes

## Key Research Findings

### Can we view listings without logging in?
- **Yes, partially.** Facebook shows ~2-4 listing cards before login modal
- Login modal CAN be bypassed: Press Escape, click outside, or click Close button
- After dismissal, public listings are accessible

### What data is visible in the DOM?
Available without login:
- Listing titles (Year Make Model)
- Prices (or "Contact for price")
- Thumbnail images
- Location (city name)
- Listing URLs: `/marketplace/item/{id}`

### Can we scroll to load more?
- Yes, infinite scroll works
- Each scroll loads 8-12 more listings
- Login wall may reappear - dismiss again
- Random delays (2-5 sec) recommended

### Rate limiting?
- ~50-100 requests/hour before blocking
- IP-based blocking possible
- Residential proxies help
- Session cookies extend access

---

## Working URL Patterns

```
# Location-based vehicle search
https://www.facebook.com/marketplace/{city}/vehicles

# With year filters (VINTAGE)
https://www.facebook.com/marketplace/austin/vehicles?minYear=1960&maxYear=1999

# Additional filters
?minPrice=5000&maxPrice=50000
?transmissionType=2  (2=manual, 1=automatic)
?sortBy=creation_time_descend
```

---

## CSS Selectors (2026)

```javascript
// Most stable - listing links
'a[href*="/marketplace/item/"]'

// Login modal indicators
'[data-testid="royal_login_form"]'
'form[action*="login"]'

// Close button
'[aria-label="Close"]'
```

---

## MCP Playwright Quick Commands

```bash
# 1. Navigate to FB Marketplace
mcp__playwright__navigate --url "https://www.facebook.com/marketplace/austin/vehicles?minYear=1960&maxYear=1999"

# 2. Screenshot to see current state
mcp__playwright__screenshot

# 3. Dismiss login modal
mcp__playwright__evaluate --script "document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))"

# 4. Extract all listing URLs
mcp__playwright__evaluate --script "Array.from(document.querySelectorAll('a[href*=\"/marketplace/item/\"]')).map(a => ({url: a.href, text: a.textContent?.substring(0,100)}))"

# 5. Scroll to load more
mcp__playwright__evaluate --script "window.scrollTo(0, document.body.scrollHeight)"

# 6. Count visible listings
mcp__playwright__evaluate --script "document.querySelectorAll('a[href*=\"/marketplace/item/\"]').length"
```

---

## Anti-Detection Best Practices

1. Use realistic user agent strings
2. Set proper viewport (1920x1080)
3. Add random delays between actions
4. Use stealth Playwright settings
5. Don't run in true headless mode
6. Rotate IPs (residential proxies preferred)

---

## Comparison with Bot UA Approach

| Aspect | Bot User Agent | Playwright |
|--------|---------------|------------|
| Complexity | Simple fetch | Full browser |
| Detection Risk | Low (looks like Google) | Higher |
| Data Quality | ~24 listings/page | More with scrolling |
| Rate Limits | Unknown | ~50-100/hr |
| Infrastructure | None | Browser needed |

**Recommendation:** Use Bot UA as primary, Playwright as fallback for deep scraping or when bot approach gets blocked.
