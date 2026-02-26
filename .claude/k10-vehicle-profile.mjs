import { chromium } from 'playwright';

const url = 'https://nuke-he73weg5a-nzero.vercel.app/vehicle/6442df03-9cac-43a8-b89e-e4fb4c08ee99';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  console.log(`Navigating to ${url}...`);

  try {
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log(`Final URL: ${page.url()}`);
    console.log(`Status: ${response?.status()}`);

    // Wait 3 seconds for page to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Screenshot 1: Top of page
    await page.screenshot({
      path: '/Users/skylar/nuke/.claude/k10-screenshot-1-top.png',
      fullPage: false
    });
    console.log('Screenshot 1 saved (top of page)');

    // Get page title and initial text
    const title = await page.title();
    console.log(`Page Title: "${title}"`);

    const topText = await page.evaluate(() => {
      return document.body?.innerText?.substring(0, 2000) || 'NO BODY TEXT';
    });
    console.log('\n=== PAGE TEXT (first 2000 chars) ===');
    console.log(topText);

    // Scroll down 600px
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Screenshot 2: After first scroll
    await page.screenshot({
      path: '/Users/skylar/nuke/.claude/k10-screenshot-2-scroll600.png',
      fullPage: false
    });
    console.log('Screenshot 2 saved (after scrolling 600px)');

    // Scroll down another 600px
    await page.evaluate(() => window.scrollBy(0, 600));
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Screenshot 3: After second scroll
    await page.screenshot({
      path: '/Users/skylar/nuke/.claude/k10-screenshot-3-scroll1200.png',
      fullPage: false
    });
    console.log('Screenshot 3 saved (after scrolling 1200px total)');

    // Get full page text for analysis
    const fullText = await page.evaluate(() => {
      return document.body?.innerText?.substring(0, 5000) || 'NO BODY TEXT';
    });
    console.log('\n=== FULL PAGE TEXT (first 5000 chars) ===');
    console.log(fullText);

    // Get page structure for understanding
    const structure = await page.evaluate(() => {
      // Look for key elements
      const results = {};

      // Vehicle title/heading
      const h1 = document.querySelector('h1');
      results.h1 = h1?.textContent?.trim();

      const h2s = Array.from(document.querySelectorAll('h2')).map(h => h.textContent?.trim()).filter(Boolean);
      results.h2s = h2s;

      // Tabs
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab, [class*="tab"]'))
        .map(t => t.textContent?.trim())
        .filter(Boolean);
      results.tabs = tabs;

      // Images
      const imgs = Array.from(document.querySelectorAll('img'))
        .map(img => ({ src: img.src?.substring(0, 100), alt: img.alt }))
        .filter(img => img.src && !img.src.includes('data:'))
        .slice(0, 10);
      results.images = imgs;

      // Buttons
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .map(b => b.textContent?.trim())
        .filter(Boolean)
        .slice(0, 20);
      results.buttons = buttons;

      // Data cards / sections
      const sections = Array.from(document.querySelectorAll('section, [class*="card"], [class*="Card"]'))
        .map(s => ({ class: s.className?.toString()?.substring(0, 80), text: s.textContent?.substring(0, 100) }))
        .slice(0, 10);
      results.sections = sections;

      return results;
    });

    console.log('\n=== PAGE STRUCTURE ===');
    console.log(JSON.stringify(structure, null, 2));

  } catch (err) {
    console.error(`Navigation error: ${err.message}`);
    try {
      await page.screenshot({
        path: '/Users/skylar/nuke/.claude/k10-screenshot-error.png',
        fullPage: false
      });
      console.log('Error screenshot taken');
    } catch (e) {
      console.error('Could not take screenshot:', e.message);
    }
  }

  await browser.close();
})();
