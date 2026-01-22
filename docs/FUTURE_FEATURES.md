
## "How Many Remain" Tool - US Classic Car Survival Data

**Inspiration:** https://www.theclassicvaluer.com/how-many-remain (UK)

**Challenge:** US has no centralized registration data (50 state DMVs vs UK's single DVLA)

**Potential Data Sources:**
- Hagerty survival analysis (editorial, no public API): https://insider.hagerty.com/trends/how-many-are-left/
- Hagerty Valuation Tools: 40K+ vehicles, 400K transactions
- NHTSA vPIC API: VIN decoding, specs (no registration counts)
- State DMV records (fragmented, requires individual requests)
- Our own auction data: BaT, C&B, RM Sotheby's, etc.

**MVP Approach:**
- Use our auction transaction data to show "market activity" by model
- Track unique VINs seen across auctions
- Show frequency of sales, geographic distribution
- Not "how many exist" but "how many are actively trading"

**Notes:**
- ~43M collector cars in US (~16% of 275M registered)
- ~15% of vehicles leave market annually
- Survival rates vary wildly: 55% for rare muscle cars, much lower for common models

Added: 2026-01-21
