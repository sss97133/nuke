/**
 * Simple C&B extraction test
 * Works around tsx __name issue by using string-based evaluate
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/98YqkadQ/2018-ferrari-gtc4lusso-t';

async function main() {
  console.log('Starting simple C&B extraction test...\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  console.log('Warming up...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Go to auction
  console.log(`Loading: ${TEST_URL}\n`);
  await page.goto(TEST_URL, { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Use addScriptTag + evaluate pattern to avoid __name issue
  const data = await page.evaluate(`
    (function() {
      var result = {};
      var bodyText = document.body.innerText;

      // VIN
      var vinMatch = bodyText.match(/VIN[:\\s#]*([A-HJ-NPR-Z0-9]{17})/i);
      result.vin = vinMatch ? vinMatch[1] : null;

      // Carfax URL - SUPER VALUABLE
      var carfaxLink = document.querySelector('a.carfax, a[title*="Carfax"], a[href*="carfax.com"]');
      result.carfaxUrl = carfaxLink ? carfaxLink.href : null;

      // Doug's Take
      var dougMatch = bodyText.match(/Doug['']s Take\\s*([\\s\\S]*?)(?=Highlights|Equipment|$)/i);
      result.dougsTake = dougMatch ? dougMatch[1].trim().substring(0, 2000) : null;

      // Quick facts
      var facts = {};
      var factEls = document.querySelectorAll('.quick-facts dt, .quick-facts dd');
      for (var i = 0; i < factEls.length; i++) {
        var el = factEls[i];
        if (el.tagName === 'DT' && factEls[i + 1] && factEls[i + 1].tagName === 'DD') {
          var key = (el.textContent || '').trim().toLowerCase();
          var val = (factEls[i + 1].textContent || '').trim();
          if (key && val) facts[key] = val;
        }
      }
      result.facts = facts;

      // Stats
      var bidsMatch = bodyText.match(/Bids\\s*(\\d+)/i);
      result.bidCount = bidsMatch ? parseInt(bidsMatch[1], 10) : null;
      var commentsMatch = bodyText.match(/Comments\\s*(\\d+)/i);
      result.commentCount = commentsMatch ? parseInt(commentsMatch[1], 10) : null;
      var viewsMatch = bodyText.match(/Views\\s*([\\d,]+)/i);
      result.viewCount = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, ''), 10) : null;
      var watchersMatch = bodyText.match(/Watch(?:ing|ers?)?\\s*([\\d,]+)/i);
      result.watcherCount = watchersMatch ? parseInt(watchersMatch[1].replace(/,/g, ''), 10) : null;

      // Current bid
      var bidValue = document.querySelector('.bid-value');
      if (bidValue) {
        var priceMatch = (bidValue.textContent || '').match(/\\$?([\\d,]+)/);
        result.currentBid = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
      }

      // Comments
      var comments = [];
      var commentEls = document.querySelectorAll('ul.thread > li');
      for (var j = 0; j < commentEls.length; j++) {
        var li = commentEls[j];
        var commentId = li.getAttribute('data-id') || '';
        var isSystem = li.classList.contains('system-comment');
        var isBid = li.classList.contains('bid');

        var userLink = li.querySelector('a[title]');
        var username = userLink ? userLink.getAttribute('title') : (isSystem ? 'SYSTEM' : 'Anonymous');
        var userHref = userLink ? userLink.getAttribute('href') : '';

        var messageEl = li.querySelector('.message p') || li.querySelector('.message');
        var text = messageEl ? (messageEl.textContent || '').trim() : '';

        var timeEl = li.querySelector('.time');
        var relativeTime = timeEl ? (timeEl.textContent || '').trim() : '';

        var fullText = li.textContent || '';
        var isSeller = fullText.toLowerCase().indexOf('seller') >= 0;
        var isBidder = fullText.toLowerCase().indexOf('bidder') >= 0;

        if (text.length > 0) {
          comments.push({
            commentId: commentId,
            username: username,
            userHref: userHref,
            text: text.substring(0, 1000),
            relativeTime: relativeTime,
            isSystem: isSystem,
            isBid: isBid,
            isSeller: isSeller,
            isBidder: isBidder
          });
        }
      }
      result.comments = comments;

      // Images
      var images = [];
      var imgEls = document.querySelectorAll('img');
      for (var k = 0; k < imgEls.length; k++) {
        var img = imgEls[k];
        var src = img.src || img.getAttribute('data-src') || '';
        if (src.indexOf('media.carsandbids.com') >= 0 &&
            !(src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0)) {
          var widthMatch = src.match(/width=(\\d+)/);
          var width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
          if (width >= 200) {
            images.push({ url: src, width: width });
          }
        }
      }
      result.images = images;

      return result;
    })()
  `);

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  EXTRACTION RESULTS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('BASIC DATA:');
  console.log(`  VIN: ${data.vin || 'N/A'}`);
  console.log(`  Current Bid: $${data.currentBid?.toLocaleString() || 'N/A'}`);
  console.log(`  Bids: ${data.bidCount || 'N/A'}`);
  console.log(`  Comments: ${data.commentCount || 'N/A'}`);
  console.log(`  Views: ${data.viewCount?.toLocaleString() || 'N/A'}`);
  console.log(`  Watchers: ${data.watcherCount || 'N/A'}`);

  console.log('\nQUICK FACTS:');
  Object.entries(data.facts || {}).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });

  console.log('\nCARFAX URL (SUPER VALUABLE):');
  console.log(`  ${data.carfaxUrl || 'NOT FOUND'}`);

  console.log('\nDOUG\'S TAKE:');
  if (data.dougsTake) {
    console.log(`  ${data.dougsTake.substring(0, 500)}...`);
  } else {
    console.log('  NOT FOUND');
  }

  console.log(`\nCOMMENTS (${data.comments?.length || 0}):`);
  (data.comments || []).slice(0, 10).forEach((c: any) => {
    const tags = [
      c.isSeller ? '[SELLER]' : '',
      c.isBidder ? '[BIDDER]' : '',
      c.isBid ? '[BID]' : '',
      c.isSystem ? '[SYSTEM]' : '',
    ].filter(Boolean).join(' ');
    console.log(`  @${c.username} ${c.relativeTime} ${tags}`);
    console.log(`    "${c.text.substring(0, 80)}${c.text.length > 80 ? '...' : ''}"`);
  });

  console.log(`\nIMAGES (${data.images?.length || 0}):`);
  (data.images || []).slice(0, 5).forEach((img: any) => {
    console.log(`  [${img.width}px] ${img.url.substring(0, 80)}...`);
  });

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
