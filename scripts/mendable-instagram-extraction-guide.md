# Extracting Instagram Profiles from Mendable

## Current Status

- **Indexed Sources**: 170 out of 10,000 ingested pages
- **Instagram Profiles Found**: 1 (`@bringatrailer`)
- **Issue**: The indexed pages are mostly Bring a Trailer's own pages, not seller/dealer profiles that would contain Instagram links

## What Pages Need to Be Ingested

To extract Instagram profiles, you need to ingest pages that contain seller/dealer social media information:

1. **Seller Profile Pages** (e.g., `bringatrailer.com/author/username/`)
2. **Dealer/Organization Profile Pages** (e.g., dealer websites, organization about pages)
3. **Vehicle Listing Pages with Seller Info** (if they include seller contact/social links)
4. **Dealer Website Pages** (homepages, about pages, contact pages)

## Next Steps

### Option 1: Ingest Seller Profile Pages
If you have a list of seller profile URLs from BaT or other sources, ingest those:

```bash
# Example: Ingest BaT seller profiles
# These would be URLs like:
# - https://bringatrailer.com/author/seller-username/
# - https://bringatrailer.com/member/seller-username/
```

### Option 2: Ingest Dealer/Organization Websites
Ingest dealer and organization websites that typically have Instagram links in their headers/footers:

```bash
# Example domains to ingest:
# - Dealer websites (homepages, about pages)
# - Organization websites
# - Classic car shop websites
```

### Option 3: Query Existing Pages More Specifically
Try querying Mendable for specific patterns:

```bash
node scripts/test-mendable-chat.js "Find any contact information, social media links, or profile pages in the ingested content"
```

## Scripts Available

1. **`scripts/extract-instagram-from-mendable.js`** - Extracts Instagram profiles from Mendable
2. **`scripts/test-mendable-chat.js`** - General Mendable query tool
3. **`scripts/get-instagram-profiles.js`** - Gets Instagram profiles from your database

## After Ingesting New Pages

Once you've ingested pages with Instagram links:

1. Wait for Mendable to index them (may take a few minutes)
2. Run the extraction script again:
   ```bash
   node scripts/extract-instagram-from-mendable.js
   ```
3. The script will find all Instagram profiles and output them in JSON format
