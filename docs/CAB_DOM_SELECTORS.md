# Cars & Bids DOM Selectors

> **VERIFIED**: 2025-01-22 via Playwright on live auction page
> **UPDATED**: 2025-01-22 with additional sections from real auction data

---

## CRITICAL SPECIAL SECTIONS

### Doug's Take
Doug DeMuro's editorial commentary on the vehicle. **MUST be saved to Doug's user profile.**
```css
/* Look for heading "Doug's Take" followed by paragraph content */
```
Contains Doug's personal opinion and analysis - valuable editorial content.

### Carfax Link (SUPER VALUABLE)
```css
a.view-report.carfax
a[title="Show me the Carfax"]
```
Example:
```html
<a rel="noopener noreferrer nofollow" class="view-report carfax"
   title="Show me the Carfax"
   href="https://www.carfax.com/vehiclehistory/ar20/..."
   target="_blank">
```
**May need Firecrawl to extract full Carfax data from that URL.**

### Seller Q&A Section
Separate from main comments - questions and answers before bidding starts.
```css
/* Section heading "Seller Q&A (N)" */
```

---

## Auction Content Sections

### Highlights
Bullet points about the vehicle:
- Mileage
- Carfax status
- Notable factory equipment
- History/background

### Equipment
Partial list of notable equipment.

### Known Flaws
Seller-disclosed issues:
- Scratches
- Chips
- Wear items

### Recent Service History
From Carfax + seller records:
- Date (Month Year)
- Mileage
- Services performed

### Seller Notes
Additional info from seller (e.g., PPF applied).

### Other Items Included
- Keys
- Accessories
- Documentation

---

## Comments

### Container
```css
ul.thread
```

### Individual Comments
```css
ul.thread > li
```

Each `<li>` has:
- `data-id` attribute - unique comment ID (e.g., "30MpJnVV")
- `class="comment"` - regular comment
- `class="system-comment"` - system message (sold, bid placed, etc.)
- `class="bid"` - bid comment

### Comment Fields

| Field | Selector | Notes |
|-------|----------|-------|
| Username | `a[title]` | **Use `title` attribute**, not textContent |
| Profile URL | `a[title]` href | Pattern: `/user/USERNAME` |
| Message | `.message p` or `.message` | Comment text |
| Time | `.time` | Relative time (e.g., "42m", "2h", "3h", "1mo") |
| Comment ID | `data-id` attribute | Unique identifier |
| Reputation | Number next to username | e.g., "33", "400", "1.2k" |
| Is Seller | "Seller" tag | Seller's comments |
| Is Bidder | "Bidder" tag | Active bidder's comments |
| Is Reply | Starts with "Re: username" | Reply to another user |
| Reply To | Parse from "Re: username" | Who they're replying to |

### Comment Types
- **Regular comment** - `class="comment"`
- **System comment** - `class="system-comment"` (Sold, bid placed)
- **Bid comment** - `class="bid"` (includes bid amount)
- **Seller comment** - Has "Seller" tag
- **Bidder comment** - Has "Bidder" tag

### Reply Pattern
Replies start with "Re: username":
```
lusso4life (Seller): Re: jaredsalinsky
  "Looked at the service record..."
```

### Reputation Scores
Users have reputation numbers displayed:
- "1" (new user)
- "33" (established)
- "400" (active)
- "1.2k" (power user)

Parse "1.2k" as 1200, etc.

### Example HTML
```html
<li data-id="30MpJnVV" class="comment">
  <div>
    <div class="username">
      <div class="photo float-left">
        <a title="Skyjim99" class="usericon" href="/user/Skyjim99">
          <img src="..." />
        </a>
      </div>
    </div>
    <div class="message">
      <p>Thanks. This was exactly what I was looking for.</p>
    </div>
    <div class="time">1mo</div>
  </div>
</li>
```

### System Comments (Sold, Bids)
```html
<li data-id="rEB2bLLd" class="system-comment">
  <!-- "Sold to Skyjim99 for $16,100" -->
</li>
```

---

## Images

### URL Pattern
```
https://media.carsandbids.com/cdn-cgi/image/width=WIDTH,quality=70/HASH/photos/CATEGORY/ID/edit/FILENAME.jpg
```

### Categories (in URL path)
| Path Segment | Category |
|--------------|----------|
| `/photos/exterior/` | Exterior shots |
| `/photos/interior/` | Interior shots |
| `/photos/` (no category) | General/mechanical/docs |

### Width Sizes
| Width | Type | Notes |
|-------|------|-------|
| `width=80,height=80` | **USER AVATARS** | ⚠️ NOT auction images! |
| `width=542` | Thumbnails | Preview grid |
| `width=768` | Medium | Sidebar/related |
| `width=2080` | Full resolution | Hero/gallery |

### To Get Full Resolution
Replace `width=X` with `width=2080` in any C&B image URL:
```javascript
const fullRes = url.replace(/width=\d+/, 'width=2080').replace(/,height=\d+/, '');
```

### Gallery Container
```css
.gallery-preview
```

### Gallery Tabs Button
```css
button.btn.btn-link.ml-auto.view-all
```
Text: "View all"

### IMPORTANT: Full Gallery Access
Initial page load only shows ~40 images. To get all 100+ images:
1. Click "View all" button to open PhotoSwipe gallery
2. Or click hero image to open gallery
3. Navigate through gallery to collect all image URLs

---

## Quick Facts / Specs

### Container
```css
.quick-facts dt, .quick-facts dd
```

### Full Spec Fields
| Field | Example Value |
|-------|---------------|
| Make | Ferrari |
| Model | GTC4Lusso |
| Mileage | 22,900 |
| VIN | ZFF82YNA3J0229627 |
| Title Status | Clean (TX) |
| Location | Austin, TX 78738 |
| Seller | lusso4life |
| Engine | 3.9L Turbocharged V8 |
| Drivetrain | Rear-wheel drive |
| Transmission | Automatic (7-Speed) |
| Body Style | Hatchback |
| Exterior Color | Rosso California |
| Interior Color | Cuoio |
| Seller Type | Private Party |

### Pattern
```html
<dl class="quick-facts">
  <dt>Mileage</dt>
  <dd>22,900</dd>
  <dt>Engine</dt>
  <dd>3.9L Turbocharged V8</dd>
</dl>
```

---

## Bid Information

### Current Bid
```css
.current-bid .bid-value
.bid-bar .bid-value
```

### Bid Count
```css
.bid-stats (parse "Bids31")
.num-bids
```

### Comment Count
```css
.bid-stats (parse "Comments62")
```

---

## Auction Status Detection

Check page text for:
- "Sold for" → sold
- "Reserve Not Met" → reserve_not_met
- "No Reserve" → no_reserve
- "Live" → live
- "This auction has ended" → ended

---

## __NEXT_DATA__

**NOT PRESENT** on C&B pages (they don't use Next.js SSR for auction data).
Must use DOM extraction.
