#!/usr/bin/env node
import { chromium } from 'playwright';

const URL = 'https://www.mecum.com/lots/1110598/1963-ferrari-250-gt-swb-california-spyder/';

async function test() {
  console.log(`Testing: ${URL}\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const nextData = await page.evaluate(() => {
    const script = document.getElementById('__NEXT_DATA__');
    return script ? JSON.parse(script.textContent) : null;
  });

  const post = nextData?.props?.pageProps?.post;

  // Extract content blocks
  const contentBlocks = [];
  const extractContent = (obj) => {
    if (!obj) return;
    if (Array.isArray(obj)) {
      obj.forEach(item => extractContent(item));
    } else if (typeof obj === 'object') {
      if (obj.content && typeof obj.content === 'string') {
        const text = obj.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 20) contentBlocks.push(text);
      }
      if (obj.innerBlocks) extractContent(obj.innerBlocks);
      if (obj.attributes) extractContent(obj.attributes);
      Object.values(obj).forEach(v => {
        if (typeof v === 'object') extractContent(v);
      });
    }
  };
  extractContent(post.blocks);

  console.log('=== KEY FIELDS ===');
  console.log('vinSerial:', post.vinSerial);
  console.log('hammerPrice:', '$' + (post.hammerPrice / 1000000).toFixed(2) + 'M');
  console.log('highEstimate:', post.highEstimate);
  console.log('lowEstimate:', post.lowEstimate);
  console.log('lotSeries:', post.lotSeries);
  console.log('collection:', post.collectionsTax?.edges?.[0]?.node?.name || 'none');
  console.log('interior:', post.interior);
  console.log('color:', post.color);

  console.log('\n=== PROVENANCE CONTENT BLOCKS ===\n');
  contentBlocks
    .filter(b =>
      b.toLowerCase().includes('owner') ||
      b.toLowerCase().includes('sold') ||
      b.toLowerCase().includes('restored') ||
      b.toLowerCase().includes('acquired')
    )
    .forEach(b => {
      console.log('---');
      console.log(b);
    });

  // Find specific ownership mentions
  console.log('\n=== PARSED OWNERS ===\n');
  const fullContent = contentBlocks.join(' ');

  const ownerMentions = [];
  const patterns = [
    /original owner (?:was )?([A-Z][a-zA-Z\s]+?) of ([^,.]+)/gi,
    /sold to ([A-Z][a-zA-Z\s]+?)(?:,? of ([^,.]+))?(?:,| in )/gi,
    /([A-Z][a-zA-Z\s]+?) of ([A-Z][a-zA-Z,\s]+?) owned/gi,
    /owned (?:the car )?(?:by )?([A-Z][a-zA-Z\s]+)/gi,
    /([A-Z][a-zA-Z\s]+?),? (?:owner|CEO|president) (?:of|and) ([^,]+)/gi
  ];

  patterns.forEach(p => {
    let match;
    while ((match = p.exec(fullContent)) !== null) {
      ownerMentions.push(match[0]);
    }
  });

  ownerMentions.forEach(m => console.log('  •', m));

  await browser.close();
  console.log('\n✅ Done');
}

test().catch(console.error);
