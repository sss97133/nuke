import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const url = 'https://nuke.ag/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  console.log('Navigating to:', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('Page loaded, waiting 4 seconds...');
  await page.waitForTimeout(4000);

  // Get page title
  const title = await page.title();
  console.log('PAGE TITLE:', title);

  // Take full page screenshot
  await page.screenshot({
    path: '/Users/skylar/nuke/.claude/vehicle-page-full.png',
    fullPage: true
  });
  console.log('Full page screenshot saved.');

  // Take viewport screenshot
  await page.screenshot({
    path: '/Users/skylar/nuke/.claude/vehicle-page-viewport.png',
    fullPage: false
  });
  console.log('Viewport screenshot saved.');

  // Analyze layout elements
  const analysis = await page.evaluate(() => {
    const results = {};

    // Hero image
    const heroImg = document.querySelector('img[class*="hero"], .hero img, [class*="hero"] img, img[src*="hero"]');
    const firstImg = document.querySelector('img');
    const heroEl = heroImg || firstImg;
    if (heroEl) {
      const rect = heroEl.getBoundingClientRect();
      results.heroImage = {
        src: heroEl.src?.substring(0, 100),
        naturalWidth: heroEl.naturalWidth,
        naturalHeight: heroEl.naturalHeight,
        displayWidth: rect.width,
        displayHeight: rect.height,
        aspectRatio: rect.width ? (rect.width / rect.height).toFixed(2) : 'unknown',
        tagName: heroEl.tagName,
        className: heroEl.className?.substring(0, 100)
      };
      // Background color of the parent/container
      const parent = heroEl.parentElement;
      if (parent) {
        const style = window.getComputedStyle(parent);
        results.heroBgColor = style.backgroundColor;
        results.heroParentClass = parent.className?.substring(0, 100);
      }
    }

    // Try to find the hero section more broadly
    const heroSection = document.querySelector('[class*="hero"], [class*="Hero"], header img, .vehicle-hero');
    if (heroSection) {
      const rect = heroSection.getBoundingClientRect();
      results.heroSection = {
        tagName: heroSection.tagName,
        className: heroSection.className?.substring(0, 100),
        width: rect.width,
        height: rect.height,
        bgColor: window.getComputedStyle(heroSection).backgroundColor
      };
    }

    // Timeline
    const timelineEl = document.querySelector('[class*="timeline"], [class*="Timeline"], [id*="timeline"]');
    if (timelineEl) {
      const rect = timelineEl.getBoundingClientRect();
      results.timeline = {
        found: true,
        className: timelineEl.className?.substring(0, 100),
        offsetTop: rect.top + window.scrollY,
        visible: rect.height > 0,
        height: rect.height,
        childCount: timelineEl.children.length,
        textPreview: timelineEl.textContent?.substring(0, 200)
      };
    } else {
      results.timeline = { found: false };
    }

    // Description
    const descEl = document.querySelector('[class*="description"], [class*="Description"], [id*="description"]');
    if (descEl) {
      const rect = descEl.getBoundingClientRect();
      results.description = {
        found: true,
        className: descEl.className?.substring(0, 100),
        visible: rect.height > 0,
        height: rect.height,
        textPreview: descEl.textContent?.substring(0, 300)
      };
    } else {
      results.description = { found: false };
    }

    // Two-column layout
    const mainContent = document.querySelector('main, [class*="main"], [class*="content"], .vehicle-detail');
    if (mainContent) {
      const children = Array.from(mainContent.children);
      results.mainContent = {
        className: mainContent.className?.substring(0, 100),
        childCount: children.length,
        children: children.map(el => ({
          tagName: el.tagName,
          className: el.className?.substring(0, 80),
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height
        }))
      };
    }

    // Look for grid/flex containers (two-column)
    const gridEls = Array.from(document.querySelectorAll('[class*="grid"], [class*="Grid"], [class*="columns"], [class*="flex"]')).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 800 && rect.height > 100;
    });
    results.gridContainers = gridEls.map(el => ({
      className: el.className?.substring(0, 100),
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      childCount: el.children.length,
      childWidths: Array.from(el.children).map(c => c.getBoundingClientRect().width)
    })).slice(0, 5);

    // Image gallery / thumbnails
    const thumbnails = document.querySelectorAll('[class*="thumbnail"], [class*="gallery"] img, [class*="thumb"] img');
    results.thumbnails = {
      count: thumbnails.length,
      samples: Array.from(thumbnails).slice(0, 3).map(el => ({
        src: el.src?.substring(0, 80),
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height
      }))
    };

    // All images on page
    const allImgs = document.querySelectorAll('img');
    results.allImages = {
      count: allImgs.length,
      list: Array.from(allImgs).slice(0, 10).map(el => ({
        src: el.src?.substring(0, 80),
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
        alt: el.alt?.substring(0, 50)
      }))
    };

    // Check for error states
    results.bodyText = document.body.textContent?.substring(0, 500);
    results.pageWidth = document.documentElement.scrollWidth;
    results.pageHeight = document.documentElement.scrollHeight;

    return results;
  });

  console.log('\n=== LAYOUT ANALYSIS ===');
  console.log(JSON.stringify(analysis, null, 2));

  await browser.close();
  console.log('\nDone.');
})();
