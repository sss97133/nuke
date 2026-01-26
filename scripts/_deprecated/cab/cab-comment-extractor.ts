/**
 * Cars & Bids Comment Extractor
 * Extracts actual comment text and usernames from C&B auction pages
 */

import { chromium, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface CABComment {
  username: string;
  userProfileUrl: string | null;
  commentText: string;
  postedAt: string | null;
  isBid: boolean;
  bidAmount: number | null;
}

async function waitForCloudflare(page: Page): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function extractComments(page: Page, url: string): Promise<CABComment[]> {
  console.log(`  Loading ${url}...`);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForTimeout(3000);

  // Scroll down to load comments
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  // Try to click "Load more comments" buttons multiple times
  for (let i = 0; i < 10; i++) {
    const loadMore = await page.$('button:has-text("Load"), a:has-text("more comments"), .load-more, [class*="load-more"]');
    if (loadMore) {
      await loadMore.click();
      await page.waitForTimeout(1500);
    } else {
      break;
    }
  }

  const comments = await page.evaluate(() => {
    const results: any[] = [];

    // C&B uses specific comment structure - analyze the DOM
    // Comments are typically in a list with username links and text
    const commentSelectors = [
      '.comment-item',
      '.comment',
      '.auction-comment',
      '[class*="CommentItem"]',
      '[class*="comment-"]',
      '.comments-section .item',
    ];

    for (const selector of commentSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements.forEach((el) => {
          // Find username - usually in an anchor tag
          const usernameEl = el.querySelector('a[href*="/user/"], a[href*="/u/"], .username, .author');
          const username = usernameEl?.textContent?.trim() || 'Anonymous';
          const userProfileUrl = usernameEl?.getAttribute('href') || null;

          // Find comment text - avoid including child elements like username
          let commentText = '';
          const textEl = el.querySelector('.comment-text, .comment-body, .text, .content, .body');
          if (textEl) {
            commentText = textEl.textContent?.trim() || '';
          } else {
            // Clone and remove username element to get just the text
            const clone = el.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('a, .username, .author, time, .timestamp').forEach(e => e.remove());
            commentText = clone.textContent?.trim() || '';
          }

          // Find timestamp
          const timeEl = el.querySelector('time, .timestamp, .date, [class*="time"], [class*="date"]');
          const postedAt = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || null;

          // Check if it's a bid
          const classList = el.className.toLowerCase();
          const isBid = classList.includes('bid') ||
                       el.textContent?.toLowerCase().includes('bid $') ||
                       el.querySelector('[class*="bid-amount"]') !== null;

          // Extract bid amount if present
          let bidAmount: number | null = null;
          if (isBid) {
            const bidMatch = el.textContent?.match(/\$[\d,]+/);
            if (bidMatch) {
              bidAmount = parseInt(bidMatch[0].replace(/[$,]/g, ''), 10);
            }
          }

          if (commentText && commentText.length > 2 && username) {
            results.push({
              username,
              userProfileUrl: userProfileUrl ? (userProfileUrl.startsWith('http') ? userProfileUrl : 'https://carsandbids.com' + userProfileUrl) : null,
              commentText: commentText.substring(0, 2000),
              postedAt,
              isBid,
              bidAmount,
            });
          }
        });

        if (results.length > 0) break;
      }
    }

    // If no structured comments found, try to parse from raw HTML
    if (results.length === 0) {
      // Look for any user links followed by text
      document.querySelectorAll('a[href*="/user/"]').forEach((userLink) => {
        const username = userLink.textContent?.trim();
        const userProfileUrl = userLink.getAttribute('href');
        const parent = userLink.parentElement?.parentElement;
        if (parent && username) {
          const clone = parent.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('a').forEach(e => e.remove());
          const text = clone.textContent?.trim();
          if (text && text.length > 5) {
            results.push({
              username,
              userProfileUrl: userProfileUrl ? 'https://carsandbids.com' + userProfileUrl : null,
              commentText: text.substring(0, 2000),
              postedAt: null,
              isBid: text.toLowerCase().includes('bid'),
              bidAmount: null,
            });
          }
        }
      });
    }

    return results;
  });

  console.log(`  Found ${comments.length} comments`);
  return comments;
}

async function saveComments(vehicleId: string, listingUrl: string, comments: CABComment[]) {
  let saved = 0;

  for (const comment of comments) {
    try {
      const { error } = await supabase
        .from('auction_comments')
        .upsert({
          vehicle_id: vehicleId,
          platform: 'cars_and_bids',
          listing_url: listingUrl,
          username: comment.username,
          user_profile_url: comment.userProfileUrl,
          comment_text: comment.commentText,
          posted_at: comment.postedAt,
          is_bid: comment.isBid,
          bid_amount: comment.bidAmount,
          created_at: new Date().toISOString(),
        }, {
          onConflict: 'vehicle_id,username,comment_text',
          ignoreDuplicates: true,
        });

      if (!error) saved++;
    } catch {
      // Ignore individual comment errors
    }
  }

  console.log(`  Saved ${saved}/${comments.length} comments`);
  return saved;
}

async function main() {
  const vehicleId = process.argv[2];

  if (!vehicleId) {
    console.log('Usage: npx tsx scripts/cab-comment-extractor.ts <vehicle_id>');
    console.log('       npx tsx scripts/cab-comment-extractor.ts 01d659db-a358-42f0-9073-60ef0aa5df69');
    return;
  }

  // Get vehicle's C&B URL
  const { data: listing } = await supabase
    .from('external_listings')
    .select('listing_url')
    .eq('vehicle_id', vehicleId)
    .eq('platform', 'cars_and_bids')
    .single();

  if (!listing?.listing_url) {
    console.log('No C&B listing found for this vehicle');
    return;
  }

  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       CARS & BIDS COMMENT EXTRACTOR                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
  console.log('Vehicle ID:', vehicleId);
  console.log('Listing URL:', listing.listing_url);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up session
  console.log('\nWarming up session...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load', timeout: 60000 });
  await waitForCloudflare(page);
  await page.waitForTimeout(2000);
  console.log('Session ready!\n');

  const comments = await extractComments(page, listing.listing_url);

  if (comments.length > 0) {
    console.log('\n=== SAMPLE COMMENTS ===');
    for (const c of comments.slice(0, 10)) {
      const bidStr = c.isBid && c.bidAmount ? ` [BID $${c.bidAmount.toLocaleString()}]` : '';
      console.log(`\n[@${c.username}]${bidStr}`);
      console.log(`  "${c.commentText.substring(0, 150)}${c.commentText.length > 150 ? '...' : ''}"`);
      if (c.userProfileUrl) console.log(`  Profile: ${c.userProfileUrl}`);
    }

    console.log('\n\nSaving to database...');
    await saveComments(vehicleId, listing.listing_url, comments);
  } else {
    console.log('\nNo comments found. The page structure may have changed.');
    console.log('Taking screenshot for debugging...');
    await page.screenshot({ path: '/tmp/cab-comments-debug.png', fullPage: true });
    console.log('Screenshot saved to /tmp/cab-comments-debug.png');
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
