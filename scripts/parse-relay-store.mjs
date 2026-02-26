import fs from 'fs';

const html = fs.readFileSync('/Users/skylar/nuke/fb-page.html', 'utf8');

// Parse the embedded relay store
const scriptPattern = /<script[^>]*>([\s\S]*?)<\/script>/g;
let m;

while ((m = scriptPattern.exec(html)) !== null) {
  const content = m[1];
  if (!content.includes('marketplace_listing_title')) continue;

  try {
    const data = JSON.parse(content);
    const schemaData = data.require[0][3][0].__bbox.require;

    // Find the RelayPrefetchedStreamCache entry
    for (const entry of schemaData) {
      if (!Array.isArray(entry) || entry[0] !== 'RelayPrefetchedStreamCache') continue;

      const queryId = entry[3][0]; // preloader ID
      const queryBox = entry[3][1].__bbox;

      console.log('=== RELAY PREFETCH DATA ===');
      console.log('Query preloader ID:', queryId);
      console.log('Complete:', queryBox.complete);

      const result = queryBox.result;
      const feedStories = result?.data?.viewer?.marketplace_feed_stories;

      console.log('\n=== MARKETPLACE FEED STORIES ===');
      console.log('Total edges:', feedStories?.edges?.length);
      console.log('Page info (end_cursor):', feedStories?.page_info?.end_cursor?.substring(0, 200));
      console.log('Has next page:', feedStories?.page_info?.has_next_page);

      // Print first 5 listings
      console.log('\n=== LISTINGS ===');
      feedStories?.edges?.forEach((edge, i) => {
        const listing = edge?.node?.listing;
        if (!listing) return;
        console.log(`\n--- Listing ${i+1} ---`);
        console.log('ID:', listing.id);
        console.log('story_key:', edge?.node?.story_key);
        console.log('Title:', listing.marketplace_listing_title);
        console.log('Custom title:', listing.custom_title);
        console.log('Price:', JSON.stringify(listing.listing_price));
        console.log('Strikethrough price:', JSON.stringify(listing.strikethrough_price));
        console.log('Location:', JSON.stringify(listing.location?.reverse_geocode));
        console.log('Is sold:', listing.is_sold);
        console.log('Is hidden:', listing.is_hidden);
        console.log('Category ID:', listing.marketplace_listing_category_id);
        console.log('sub_titles:', JSON.stringify(listing.custom_sub_titles_with_rendering_flags));
        console.log('Photo:', listing.primary_listing_photo?.image?.uri?.substring(0, 100));
        console.log('__typename:', listing.__typename);
      });

      // Also save the raw query box for analysis
      fs.writeFileSync('/Users/skylar/nuke/fb-relay-query-box.json', JSON.stringify(queryBox, null, 2));
      console.log('\n\nQuery box saved to fb-relay-query-box.json');

      // Also save the full feed stories data
      fs.writeFileSync('/Users/skylar/nuke/fb-feed-stories.json', JSON.stringify(feedStories, null, 2));
      console.log('Feed stories saved to fb-feed-stories.json');
    }

  } catch(e) {
    console.log('Error:', e.message, e.stack?.substring(0, 200));
  }
  break;
}
