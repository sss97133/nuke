# duPont Registry Profile Creation Guide

## Overview

This document details how to create **organization profiles** and **user profiles** (external identities) for duPont Registry ingestion.

---

## 1. Platform Organization Profiles

### duPont Registry (Main Marketplace)

**Create once** for the platform itself:

```typescript
const dupontRegistryOrg = {
  business_name: 'duPont Registry',
  business_type: 'marketplace',
  website: 'https://www.dupontregistry.com',
  description: 'Luxury and exotic car marketplace featuring dealer and private sales',
  is_public: true,
  is_verified: false,
  metadata: {
    platforms: ['www.dupontregistry.com'],
    source_type: 'marketplace',
    has_auctions: false
  }
};
```

### duPont Registry Live (Auction Platform)

**Create separately** for the auction subdomain:

```typescript
const dupontRegistryLiveOrg = {
  business_name: 'duPont Registry Live',
  business_type: 'auction_house',
  website: 'https://live.dupontregistry.com',
  description: 'Live auction platform for luxury and exotic vehicles',
  is_public: true,
  is_verified: false,
  metadata: {
    platforms: ['live.dupontregistry.com'],
    source_type: 'auction_house',
    parent_platform: 'dupontregistry.com',
    has_bidding: true,
    has_14_day_return: true,
    sell_through_rate: '100%'
  }
};
```

**Implementation:**
```typescript
async function ensurePlatformOrganizations(supabase: any) {
  // Main marketplace
  const { data: mainOrg } = await supabase
    .from('businesses')
    .select('id')
    .eq('website', 'https://www.dupontregistry.com')
    .maybeSingle();

  if (!mainOrg) {
    await supabase.from('businesses').insert(dupontRegistryOrg);
  }

  // Live auctions
  const { data: liveOrg } = await supabase
    .from('businesses')
    .select('id')
    .eq('website', 'https://live.dupontregistry.com')
    .maybeSingle();

  if (!liveOrg) {
    await supabase.from('businesses').insert(dupontRegistryLiveOrg);
  }
}
```

---

## 2. User Profiles (External Identities)

### Bidders/Sellers from Auctions

**Extract from auction listings:**
- **Current Bidder**: `raw_data.current_bidder` (username)
- **All Bidders**: `raw_data.bidder_usernames` (array)
- **Seller**: `raw_data.seller_name` (if private seller)

**User Profile URL Pattern:**
- `https://live.dupontregistry.com/user/{username}`
- **Example**: `https://live.dupontregistry.com/user/mark.goldman431`

**Create External Identity:**

```typescript
async function createUserProfile(
  username: string,
  displayName: string | null,
  userType: 'bidder' | 'seller' | 'both',
  sourceUrl: string,
  supabase: any
) {
  const profileUrl = `https://live.dupontregistry.com/user/${username}`;

  // Check if exists
  const { data: existing } = await supabase
    .from('external_identities')
    .select('id')
    .eq('platform', 'dupontregistry')
    .eq('handle', username.toLowerCase())
    .maybeSingle();

  if (existing) {
    // Update last_seen_at
    await supabase
      .from('external_identities')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existing.id);
    return existing.id;
  }

  // Create new
  const { data: newIdentity } = await supabase
    .from('external_identities')
    .insert({
      platform: 'dupontregistry',
      handle: username.toLowerCase(),
      profile_url: profileUrl,
      display_name: displayName || username,
      metadata: {
        user_type: userType,
        first_seen_at: new Date().toISOString(),
        discovered_from: sourceUrl
      }
    })
    .select('id')
    .single();

  return newIdentity?.id;
}
```

**Usage in Scraper:**
```typescript
// From auction listing
if (listing.current_bid_username) {
  await createUserProfile(
    listing.current_bid_username,
    null, // Display name from profile page (if accessible)
    'bidder',
    listing.url,
    supabase
  );
}

// All bidders
for (const username of listing.bidder_usernames || []) {
  await createUserProfile(username, null, 'bidder', listing.url, supabase);
}

// Private seller
if (listing.seller_type === 'private' && listing.seller_name) {
  await createUserProfile(
    listing.seller_name, // May need to extract username from profile
    listing.seller_name,
    'seller',
    listing.url,
    supabase
  );
}
```

**Note**: User profile pages may require login. Scrape what's accessible, or use authenticated session if needed.

---

## 3. Dealer Organization Profiles

### Dealer Profile Structure

**URL Pattern:**
- `https://www.dupontregistry.com/autos/{dealer-slug}/{dealer-id}`
- **Example**: `https://www.dupontregistry.com/autos/lexani--motorcars/734`

**Fields to Extract:**

| Source | Database Field | Example |
|--------|----------------|---------|
| Dealer Name | `business_name` | "Lexani Motorcars" |
| Dealer Slug | `metadata.dupont_registry_slug` | "lexani--motorcars" |
| Dealer ID | `metadata.dupont_registry_id` | "734" |
| Dealer Website | `website` | "https://lexanimotorcars.com/" |
| Dealer Location | `city`, `state` | "California" |
| Dealer Phone | `phone` | "+1 951.531.6801" |
| Dealer Email | `email` | If available |
| Dealer Description | `description` | Business description |
| Inventory URL | `metadata.inventory_url` | Link to dealer inventory |
| Instagram Handle | `metadata.instagram_handle` | "lexanimotorcars" |
| Instagram URL | External identity | `https://www.instagram.com/lexanimotorcars/` |

### Special Case: Lexani Motorcars

**Characteristics:**
- **Website**: `https://lexanimotorcars.com/` (weird/shitty site per user)
- **Instagram**: `https://www.instagram.com/lexanimotorcars/` (clear presence)
- **Business Type**: `'custom_conversion'` or `'specialty_shop'`
- **Specializations**: 
  - Custom luxury interior conversions
  - Executive vehicle conversions
  - Armored vehicle conversions
  - Luxury SUV custom upgrades
  - Executive mobile office conversions
- **Note**: Lots of fake/generated imagery (be aware when scraping)
- **Strategy**: 
  - Prioritize Instagram for real imagery
  - Use website for contact info only
  - Mark images as potentially generated in metadata
  - **Extract business model from website content automatically**

**Business Intelligence Extraction:**
From website content analysis:
- "boutique custom luxury vehicle conversion company"
- "custom luxury interiors"
- "Executive Escalade conversions"
- "armored luxury vehicle interiors"
- "executive mobile office"

**Should extract:**
- `business_type`: `'custom_conversion'` or `'specialty_shop'`
- `specializations`: `['custom_interiors', 'executive_conversions', 'armored_vehicles', 'luxury_suv_upgrades']`
- `description`: Full business description from website
- `metadata.business_model`: `'interior_conversion'` or `'custom_build'`

**Implementation:**

```typescript
async function createDealerOrganization(
  dealerData: {
    name: string;
    slug: string;
    id: string;
    website?: string | null;
    location?: string | null;
    phone?: string | null;
    email?: string | null;
    description?: string | null;
    instagramHandle?: string | null;
  },
  sourceUrl: string,
  supabase: any
): Promise<string | null> {
  // Check if exists by name or website
  let existingOrg = null;

  if (dealerData.website) {
    const { data } = await supabase
      .from('businesses')
      .select('id')
      .or(`website.eq.${dealerData.website},website.eq.${dealerData.website.replace(/\/$/, '')}`)
      .maybeSingle();
    existingOrg = data;
  }

  if (!existingOrg) {
    const { data } = await supabase
      .from('businesses')
      .select('id')
      .ilike('business_name', `%${dealerData.name}%`)
      .maybeSingle();
    existingOrg = data;
  }

  if (existingOrg) {
    // Update metadata if needed
    await supabase
      .from('businesses')
      .update({
        metadata: {
          ...(existingOrg.metadata || {}),
          dupont_registry_slug: dealerData.slug,
          dupont_registry_id: dealerData.id,
          dupont_registry_url: sourceUrl
        }
      })
      .eq('id', existingOrg.id);
    return existingOrg.id;
  }

  // Parse location
  const locationParts = dealerData.location?.split(',') || [];
  const city = locationParts[0]?.trim() || null;
  const state = locationParts[1]?.trim() || null;

  // Extract business intelligence from website (if available)
  let businessType = 'dealership';
  let specializations: string[] = [];
  let businessModel: string | null = null;
  
  if (dealerData.website) {
    try {
      // Scrape website to extract business model
      const websiteContent = await scrapeWebsiteContent(dealerData.website);
      const businessIntelligence = analyzeBusinessModel(websiteContent);
      
      businessType = businessIntelligence.businessType || 'dealership';
      specializations = businessIntelligence.specializations || [];
      businessModel = businessIntelligence.businessModel || null;
      
      // Update description if website has better content
      if (businessIntelligence.description && !dealerData.description) {
        dealerData.description = businessIntelligence.description;
      }
    } catch (err) {
      console.warn('Failed to extract business intelligence from website:', err);
    }
  }

  // Create organization
  const { data: newOrg, error } = await supabase
    .from('businesses')
    .insert({
      business_name: dealerData.name,
      business_type: businessType, // Auto-detected from website
      website: dealerData.website,
      phone: dealerData.phone,
      email: dealerData.email,
      city: city,
      state: state,
      description: dealerData.description,
      specializations: specializations.length > 0 ? specializations : null,
      is_public: true,
      metadata: {
        dupont_registry_slug: dealerData.slug,
        dupont_registry_id: dealerData.id,
        dupont_registry_url: sourceUrl,
        instagram_handle: dealerData.instagramHandle,
        discovered_from: sourceUrl,
        discovered_at: new Date().toISOString(),
        business_model: businessModel, // e.g., 'interior_conversion', 'custom_build'
        // Special flags for weird websites
        website_quality: dealerData.website ? 'low' : null, // If known to be weird
        prefer_instagram_images: dealerData.instagramHandle ? true : false
      }
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error creating dealer organization:', error);
    return null;
  }

  // Create external identity for Instagram (if available)
  if (dealerData.instagramHandle && newOrg) {
    await supabase.from('external_identities').insert({
      platform: 'instagram',
      handle: dealerData.instagramHandle.toLowerCase(),
      profile_url: `https://www.instagram.com/${dealerData.instagramHandle}/`,
      display_name: dealerData.name,
      metadata: {
        organization_id: newOrg.id,
        linked_at: new Date().toISOString(),
        source: 'dupontregistry'
      }
    });
  }

  // Trigger external data extraction if website exists
  if (newOrg && dealerData.website) {
    try {
      await supabase.functions.invoke('extract-organization-from-seller', {
        body: {
          seller_name: dealerData.name,
          seller_url: sourceUrl,
          website: dealerData.website,
          platform: 'dupontregistry'
        }
      });
    } catch (err) {
      console.warn('Failed to trigger external data extraction:', err);
    }
  }

  return newOrg?.id;
}
```

---

## 4. DOM Selectors for Profile Pages

### Dealer Profile Page (`/autos/{dealer-slug}/{id}`)

**Selectors:**

```css
/* Dealer Name */
h1[class*="dealer-name"]
[class*="dealer-title"]

/* Dealer Website */
a[href*="http"][class*="website"]
[class*="dealer-website"]

/* Dealer Location */
[class*="location"]
[class*="dealer-location"]

/* Dealer Phone */
[class*="phone"]
[class*="contact-phone"]

/* Dealer Email */
a[href^="mailto:"]
[class*="email"]

/* Dealer Description */
[class*="description"]
[class*="about"]

/* Inventory Link */
a[href*="/autos/results"][class*="inventory"]
[class*="view-inventory"]

/* Social Media Links */
a[href*="instagram.com"]
a[href*="facebook.com"]
a[href*="twitter.com"]
```

### User Profile Page (`live.dupontregistry.com/user/{username}`)

**Selectors:**

```css
/* Username */
[class*="username"]
[class*="user-handle"]

/* Display Name */
[class*="display-name"]
[class*="user-name"]

/* Profile Stats */
[class*="bids"]
[class*="watching"]
[class*="sold"]

/* Activity Feed */
[class*="activity"]
[class*="recent-bids"]
[class*="listings"]
```

**Note**: User profile pages may require login. Test accessibility first.

---

## 5. Integration with Vehicle Ingestion

### Link Vehicles to Organizations

```typescript
// After creating vehicle
if (vehicleId && dealerOrgId) {
  await supabase.from('organization_vehicles').insert({
    organization_id: dealerOrgId,
    vehicle_id: vehicleId,
    relationship_type: 'seller', // or 'in_stock', 'consignment'
    status: 'active',
    metadata: {
      discovered_from: listingUrl,
      listing_status: listingStatus
    }
  });
}
```

### Link Vehicles to Platform Organizations

```typescript
// Link to duPont Registry platform
if (vehicleId && dupontRegistryOrgId) {
  await supabase.from('organization_vehicles').insert({
    organization_id: dupontRegistryOrgId,
    vehicle_id: vehicleId,
    relationship_type: 'listed_on',
    status: 'active'
  });
}
```

---

## 6. Summary

### Organizations Created
1. ✅ **duPont Registry** (main marketplace)
2. ✅ **duPont Registry Live** (auction platform)
3. ✅ **Dealer Organizations** (from dealer profiles)
4. ✅ **External Identities** (Instagram links for dealers)

### User Profiles Created
1. ✅ **Bidders** (from auction listings)
2. ✅ **Sellers** (private sellers from listings)
3. ✅ **User Profiles** (from `live.dupontregistry.com/user/{username}`)

### Special Handling
- ✅ **Lexani-style dealers**: Weird website, clear Instagram → prioritize Instagram
- ✅ **Fake imagery**: Mark in metadata, prefer Instagram images
- ✅ **Login requirements**: Use authenticated session only for discovery if needed

---

## Next Steps

1. ✅ Implement platform organization creation (run once)
2. ✅ Add user profile creation to auction scraper
3. ✅ Add dealer profile scraper
4. ✅ Link vehicles to organizations
5. ✅ Test with sample data
6. ✅ Deploy and monitor

