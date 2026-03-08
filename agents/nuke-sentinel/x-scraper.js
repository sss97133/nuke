#!/usr/bin/env node
/**
 * X/Twitter scraper using Playwright
 * Fetches recent tweets from specified accounts
 */

const { chromium } = require('playwright');

const ACCOUNTS = [
  'AnthropicAI',
  'alexalbert__',
  'swyx',
  'karpathy'
];

const KEYWORDS = ['claude', 'anthropic', 'mcp', 'opus', 'sonnet', 'ai agent'];

async function scrapeTweets(account, maxTweets = 10) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const tweets = [];

  try {
    console.log(`Fetching @${account}...`);
    await page.goto(`https://x.com/${account}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait for tweets to load
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });

    // Extract tweets
    const tweetElements = await page.$$('article[data-testid="tweet"]');

    for (let i = 0; i < Math.min(tweetElements.length, maxTweets); i++) {
      const tweet = tweetElements[i];

      try {
        // Get tweet text
        const textEl = await tweet.$('[data-testid="tweetText"]');
        const text = textEl ? await textEl.innerText() : '';

        // Get timestamp/link
        const timeEl = await tweet.$('time');
        const datetime = timeEl ? await timeEl.getAttribute('datetime') : '';

        // Get tweet link
        const linkEl = await tweet.$('a[href*="/status/"]');
        const href = linkEl ? await linkEl.getAttribute('href') : '';
        const link = href ? `https://x.com${href}` : '';

        if (text) {
          tweets.push({
            account,
            text: text.substring(0, 500),
            datetime,
            link,
            source: 'x'
          });
        }
      } catch (e) {
        // Skip malformed tweets
      }
    }

  } catch (error) {
    console.error(`Error scraping @${account}: ${error.message}`);
  } finally {
    await browser.close();
  }

  return tweets;
}

async function scrapeAllAccounts() {
  const allTweets = [];

  for (const account of ACCOUNTS) {
    const tweets = await scrapeTweets(account, 5);
    allTweets.push(...tweets);

    // Rate limit
    await new Promise(r => setTimeout(r, 2000));
  }

  // Filter by keywords
  const relevant = allTweets.filter(t => {
    const lower = t.text.toLowerCase();
    return KEYWORDS.some(kw => lower.includes(kw));
  });

  console.log(`\n=== Results ===`);
  console.log(`Total tweets: ${allTweets.length}`);
  console.log(`Keyword matches: ${relevant.length}`);

  // Output as JSON
  console.log('\n' + JSON.stringify({
    all: allTweets,
    relevant,
    timestamp: new Date().toISOString()
  }, null, 2));

  return { all: allTweets, relevant };
}

// Run
scrapeAllAccounts().catch(console.error);
