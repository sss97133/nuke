#!/usr/bin/env node
/**
 * Debug site structure - outputs HTML selectors
 */

import { chromium } from 'playwright';

const site = process.argv[2] || 'pcarmarket';

const SITES = {
  pcarmarket: 'https://pcarmarket.com/vehicles/',
  hemmings: 'https://www.hemmings.com/classifieds/cars-for-sale',
  hagerty: 'https://www.hagerty.com/marketplace',
  mecum: 'https://www.mecum.com/auctions/monterey-2024/lots/',
};

async function debug() {
  const url = SITES[site];
  if (!url) {
    console.log('Usage: node debug-site.js [pcarmarket|hemmings|hagerty|mecum]');
    return;
  }

  console.log(`Debugging: ${site} → ${url}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const allLinks = [...document.querySelectorAll('a')].map(a => a.href).filter(h => h.includes('/'));
    const uniquePatterns = [...new Set(allLinks.map(l => {
      try {
        const u = new URL(l);
        return u.pathname.split('/').slice(0, 3).join('/');
      } catch { return null; }
    }))].filter(Boolean).slice(0, 20);

    // Find listing-like cards
    const cards = document.querySelectorAll('article, .card, .listing, .lot, [class*="listing"], [class*="vehicle"], [class*="item"]');

    // Sample first card
    let sampleCard = null;
    if (cards.length > 0) {
      const card = cards[0];
      sampleCard = {
        tagName: card.tagName,
        className: card.className,
        text: card.innerText?.slice(0, 300),
        links: [...card.querySelectorAll('a')].map(a => a.href).slice(0, 3),
        images: [...card.querySelectorAll('img')].map(i => i.src?.slice(0, 80)).slice(0, 2),
      };
    }

    return {
      title: document.title,
      url: window.location.href,
      linkPatterns: uniquePatterns,
      cardCount: cards.length,
      sampleCard,
      bodyPreview: document.body?.innerText?.slice(0, 500),
    };
  });

  console.log('Title:', info.title);
  console.log('URL:', info.url);
  console.log('\nLink patterns found:', info.linkPatterns);
  console.log('\nCard-like elements:', info.cardCount);

  if (info.sampleCard) {
    console.log('\nSample card:');
    console.log('  Tag:', info.sampleCard.tagName);
    console.log('  Class:', info.sampleCard.className);
    console.log('  Links:', info.sampleCard.links);
    console.log('  Images:', info.sampleCard.images);
    console.log('  Text:', info.sampleCard.text?.slice(0, 200));
  }

  console.log('\nBody preview:', info.bodyPreview?.slice(0, 300));

  await browser.close();
}

debug().catch(console.error);
