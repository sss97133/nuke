/**
 * Debug script for BMW M3 auction - 65 comments not showing
 * https://carsandbids.com/auctions/KdlxGqJL/2008-bmw-m3-sedan
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/KdlxGqJL/2008-bmw-m3-sedan';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  DEBUG: BMW M3 COMMENT EXTRACTION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up on C&B
  console.log('Warming up on C&B...');
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

  // Check initial comment state
  const initialState = await page.evaluate(`
    (function() {
      var result = {};
      var bodyText = document.body.innerText || '';

      // Comment count from page text
      var commentsMatch = bodyText.match(/Comments\\s*(\\d+)/i);
      result.displayedCommentCount = commentsMatch ? parseInt(commentsMatch[1], 10) : null;

      // Actual comment elements
      var commentEls = document.querySelectorAll('ul.thread > li');
      result.actualCommentElements = commentEls.length;

      // Check for "Load more" or pagination
      var loadMoreBtns = document.querySelectorAll('button, a');
      var loadMoreTexts = [];
      for (var i = 0; i < loadMoreBtns.length; i++) {
        var text = (loadMoreBtns[i].textContent || '').toLowerCase();
        if (text.indexOf('load') >= 0 || text.indexOf('more') >= 0 || text.indexOf('show') >= 0) {
          loadMoreTexts.push(text.trim().substring(0, 50));
        }
      }
      result.loadMoreButtons = loadMoreTexts;

      // Check for comment section visibility
      var threadEl = document.querySelector('ul.thread');
      result.threadExists = !!threadEl;
      result.threadVisible = threadEl ? threadEl.offsetParent !== null : false;

      // Check auction state
      result.auctionState = '';
      if (bodyText.indexOf('Sold') >= 0) result.auctionState = 'Sold';
      else if (bodyText.indexOf('Reserve Not Met') >= 0) result.auctionState = 'Reserve Not Met';
      else if (bodyText.indexOf('No Sale') >= 0) result.auctionState = 'No Sale';
      else if (bodyText.indexOf('Bid to') >= 0) result.auctionState = 'Bid to (Reserve Not Met)';

      // Get bid info
      var bidMatch = bodyText.match(/(?:Sold|Bid)\\s*(?:for|to)?\\s*\\$?([\\d,]+)/i);
      result.bidAmount = bidMatch ? bidMatch[1] : null;

      return result;
    })()
  `);

  console.log('INITIAL STATE:');
  console.log(`  Displayed comment count: ${initialState.displayedCommentCount}`);
  console.log(`  Actual comment elements: ${initialState.actualCommentElements}`);
  console.log(`  Thread exists: ${initialState.threadExists}`);
  console.log(`  Thread visible: ${initialState.threadVisible}`);
  console.log(`  Auction state: ${initialState.auctionState}`);
  console.log(`  Bid amount: ${initialState.bidAmount}`);
  console.log(`  Load more buttons found: ${initialState.loadMoreButtons.length}`);
  if (initialState.loadMoreButtons.length > 0) {
    initialState.loadMoreButtons.forEach((t: string) => console.log(`    - "${t}"`));
  }

  // Scroll to comments section
  console.log('\nScrolling to comments section...');
  await page.evaluate(`
    (function() {
      var thread = document.querySelector('ul.thread');
      if (thread) thread.scrollIntoView({ behavior: 'smooth' });
    })()
  `);
  await page.waitForTimeout(2000);

  // Look for and click "Load more comments" buttons
  console.log('\nLooking for load more buttons...');

  let loadAttempts = 0;
  const maxAttempts = 10;

  while (loadAttempts < maxAttempts) {
    // Check for load more button
    const hasLoadMore = await page.evaluate(`
      (function() {
        var buttons = document.querySelectorAll('button, a, .load-more, [class*="load"]');
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || '').toLowerCase();
          var cls = (buttons[i].className || '').toLowerCase();
          if (text.indexOf('load more') >= 0 ||
              text.indexOf('show more') >= 0 ||
              cls.indexOf('load-more') >= 0) {
            return { found: true, text: text.trim().substring(0, 50) };
          }
        }
        return { found: false };
      })()
    `);

    if (!hasLoadMore.found) {
      console.log('  No more "load more" buttons found');
      break;
    }

    console.log(`  Found: "${hasLoadMore.text}" - clicking...`);

    // Click the button
    await page.evaluate(`
      (function() {
        var buttons = document.querySelectorAll('button, a, .load-more, [class*="load"]');
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || '').toLowerCase();
          var cls = (buttons[i].className || '').toLowerCase();
          if (text.indexOf('load more') >= 0 ||
              text.indexOf('show more') >= 0 ||
              cls.indexOf('load-more') >= 0) {
            buttons[i].click();
            return;
          }
        }
      })()
    `);

    await page.waitForTimeout(1500);
    loadAttempts++;

    // Check new count
    const newCount = await page.evaluate(`
      document.querySelectorAll('ul.thread > li').length
    `);
    console.log(`  Comments now: ${newCount}`);
  }

  // Final extraction
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  FINAL EXTRACTION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const finalData = await page.evaluate(`
    (function() {
      var result = {};
      var bodyText = document.body.innerText || '';

      // Auction state details
      result.isSold = bodyText.indexOf('Sold for') >= 0;
      result.isReserveNotMet = bodyText.indexOf('Reserve Not Met') >= 0 || bodyText.indexOf('Bid to') >= 0;
      result.isNoSale = bodyText.indexOf('No Sale') >= 0;

      // Price
      var soldMatch = bodyText.match(/Sold\\s*for\\s*\\$?([\\d,]+)/i);
      var bidToMatch = bodyText.match(/Bid\\s*to\\s*\\$?([\\d,]+)/i);
      result.soldPrice = soldMatch ? soldMatch[1] : null;
      result.bidToPrice = bidToMatch ? bidToMatch[1] : null;

      // Comments
      var comments = [];
      var commentEls = document.querySelectorAll('ul.thread > li');
      for (var c = 0; c < commentEls.length; c++) {
        var li = commentEls[c];
        var commentId = li.getAttribute('data-id') || '';
        var isSystem = li.classList.contains('system-comment');
        var isBid = li.classList.contains('bid');

        var userLink = li.querySelector('a[title]');
        var username = userLink ? (userLink.getAttribute('title') || 'Anonymous') : (isSystem ? 'SYSTEM' : 'Anonymous');

        var messageEl = li.querySelector('.message p') || li.querySelector('.message');
        var text = messageEl ? (messageEl.textContent || '').trim() : '';

        var timeEl = li.querySelector('.time');
        var relativeTime = timeEl ? (timeEl.textContent || '').trim() : '';

        var liText = li.textContent || '';
        var isSeller = liText.toLowerCase().indexOf('seller') >= 0;

        if (text.length > 0 || isBid || isSystem) {
          comments.push({
            id: commentId,
            username: username,
            text: text.substring(0, 500),
            time: relativeTime,
            isSystem: isSystem,
            isBid: isBid,
            isSeller: isSeller
          });
        }
      }
      result.comments = comments;
      result.commentCount = comments.length;

      return result;
    })()
  `);

  console.log(`Auction State:`);
  console.log(`  Sold: ${finalData.isSold} ${finalData.soldPrice ? '($' + finalData.soldPrice + ')' : ''}`);
  console.log(`  Reserve Not Met: ${finalData.isReserveNotMet} ${finalData.bidToPrice ? '(Bid to $' + finalData.bidToPrice + ')' : ''}`);
  console.log(`  No Sale: ${finalData.isNoSale}`);

  console.log(`\nComments Extracted: ${finalData.commentCount}`);

  if (finalData.comments.length > 0) {
    console.log('\nSample comments:');
    finalData.comments.slice(0, 15).forEach((c: any, i: number) => {
      const tags = [
        c.isSeller ? '[SELLER]' : '',
        c.isBid ? '[BID]' : '',
        c.isSystem ? '[SYSTEM]' : '',
      ].filter(Boolean).join(' ');
      console.log(`  ${i + 1}. @${c.username} ${c.time} ${tags}`);
      if (c.text) console.log(`     "${c.text.substring(0, 100)}${c.text.length > 100 ? '...' : ''}"`);
    });
  }

  console.log('\n\nDone. Closing browser.');
  await browser.close();
}

main().catch(console.error);
