import { chromium } from 'playwright';

const url = 'https://nuke.ag/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // Screenshot 1: Hero image close-up (top of page)
  await page.screenshot({
    path: '/Users/skylar/nuke/.claude/section-hero.png',
    clip: { x: 0, y: 0, width: 1440, height: 680 }
  });

  // Screenshot 2: Timeline section
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/Users/skylar/nuke/.claude/section-timeline.png',
    clip: { x: 0, y: 0, width: 1440, height: 900 }
  });

  // Screenshot 3: Description + two column area
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: '/Users/skylar/nuke/.claude/section-description.png',
    clip: { x: 0, y: 0, width: 1440, height: 900 }
  });

  // Get detailed measurements of key elements
  const measurements = await page.evaluate(() => {
    const result = {};

    // Hero image container
    const heroDiv = document.querySelector('.hero-image');
    if (heroDiv) {
      const rect = heroDiv.getBoundingClientRect();
      const style = window.getComputedStyle(heroDiv);
      result.heroContainer = {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        bgColor: style.backgroundColor,
        bgImage: style.backgroundImage?.substring(0, 100)
      };
    }

    // The actual hero img inside
    const heroImgSelector = '.hero-image img, [class*="hero"] img[src*="vehicle"], [class*="hero"] img[src*="supabase"]';
    const heroImg = document.querySelector(heroImgSelector);
    if (heroImg) {
      const rect = heroImg.getBoundingClientRect();
      result.heroImg = {
        src: heroImg.src?.substring(0, 120),
        displayW: rect.width,
        displayH: rect.height,
        naturalW: heroImg.naturalWidth,
        naturalH: heroImg.naturalHeight,
        objectFit: window.getComputedStyle(heroImg).objectFit
      };
    }

    // Check what's inside .hero-image
    const heroDiv2 = document.querySelector('.hero-image');
    if (heroDiv2) {
      result.heroChildren = Array.from(heroDiv2.querySelectorAll('*')).slice(0, 10).map(el => ({
        tag: el.tagName,
        class: el.className?.substring(0, 60),
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height
      }));
    }

    // Main two-column container - look for any flex/grid with 2 children of roughly equal width
    const allDivs = document.querySelectorAll('div');
    const twoColDivs = [];
    for (const div of allDivs) {
      const children = Array.from(div.children);
      if (children.length === 2) {
        const rect = div.getBoundingClientRect();
        if (rect.width > 800 && rect.height > 200) {
          const leftRect = children[0].getBoundingClientRect();
          const rightRect = children[1].getBoundingClientRect();
          if (leftRect.width > 300 && rightRect.width > 300) {
            twoColDivs.push({
              class: div.className?.substring(0, 80),
              totalW: rect.width,
              leftW: leftRect.width,
              rightW: rightRect.width,
              leftClass: children[0].className?.substring(0, 60),
              rightClass: children[1].className?.substring(0, 60)
            });
          }
        }
      }
    }
    result.twoColCandidates = twoColDivs.slice(0, 5);

    // Right column gallery
    const vehicleImages = Array.from(document.querySelectorAll('img[alt="Vehicle image"]'));
    result.vehicleImages = vehicleImages.map(img => {
      const rect = img.getBoundingClientRect();
      return {
        src: img.src?.substring(0, 100),
        displayW: rect.width,
        displayH: rect.height,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
        top: rect.top,
        left: rect.left
      };
    }).slice(0, 10);

    // Description text
    const descText = document.querySelector('[class*="description"] p, [class*="Description"] p, .description');
    if (descText) {
      result.descriptionText = descText.textContent?.substring(0, 400);
    }

    // All section headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, [class*="section-title"], [class*="SectionTitle"]'));
    result.headings = headings.map(h => ({
      tag: h.tagName,
      text: h.textContent?.substring(0, 60),
      top: h.getBoundingClientRect().top + window.scrollY
    }));

    // Tab labels visible on page
    const tabs = Array.from(document.querySelectorAll('[class*="tab"], [role="tab"]'));
    result.tabs = tabs.map(t => ({
      text: t.textContent?.substring(0, 40),
      class: t.className?.substring(0, 60)
    }));

    return result;
  });

  console.log(JSON.stringify(measurements, null, 2));

  await browser.close();
})();
