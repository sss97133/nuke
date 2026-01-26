import { chromium } from 'playwright';

async function extractComments() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newContext().then(c => c.newPage());

  await page.goto('https://carsandbids.com');
  await page.waitForTimeout(5000);

  await page.goto('https://carsandbids.com/auctions/3R0lA8Bv/2005-porsche-cayenne');
  await page.waitForTimeout(5000);

  // Scroll to load comments
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);

  const comments = await page.evaluate(() => {
    const results: any[] = [];

    // C&B structure: ul.thread > li.comment
    document.querySelectorAll('ul.thread > li').forEach((li) => {
      const dataId = li.getAttribute('data-id');
      const isSystem = li.classList.contains('system-comment');
      const isBid = li.classList.contains('bid');

      // Username from title attribute
      const userLink = li.querySelector('.username a[title], .usericon-name a[title], a[title]');
      const username = userLink?.getAttribute('title') || (isSystem ? 'SYSTEM' : 'Anonymous');
      const userHref = userLink?.getAttribute('href') || null;

      // Comment text from .message p
      const messageEl = li.querySelector('.message p, .content .message p, .message');
      const commentText = messageEl?.textContent?.trim() || '';

      // Time
      const timeEl = li.querySelector('.time');
      const timeText = timeEl?.textContent?.trim() || null;

      // Bid amount - parse from text
      let bidAmount: number | null = null;
      const dollarMatch = commentText.match(/\$[\d,]+/);
      if (dollarMatch) {
        bidAmount = parseInt(dollarMatch[0].replace(/[$,]/g, ''), 10);
      }

      if (commentText) {
        results.push({
          id: dataId,
          username,
          userProfileUrl: userHref ? (userHref.startsWith('http') ? userHref : 'https://carsandbids.com' + userHref) : null,
          text: commentText,
          time: timeText,
          isSystem,
          isBid: isBid || commentText.toLowerCase().includes('bid'),
          bidAmount,
        });
      }
    });

    return results;
  });

  console.log('Found', comments.length, 'comments:\n');

  for (const c of comments.slice(0, 20)) {
    const bidStr = c.bidAmount ? ` [$${c.bidAmount.toLocaleString()}]` : '';
    const sysStr = c.isSystem ? ' [SYSTEM]' : '';
    console.log(`@${c.username}${bidStr}${sysStr}`);
    console.log(`  "${c.text.substring(0, 150)}${c.text.length > 150 ? '...' : ''}"`);
    if (c.userProfileUrl) console.log(`  Profile: ${c.userProfileUrl}`);
    console.log('');
  }

  await browser.close();
}

extractComments();
