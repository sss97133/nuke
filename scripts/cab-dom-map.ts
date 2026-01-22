/**
 * C&B DOM Structure Mapper
 * Opens a real auction page and dumps the actual DOM structure
 * for comments and images so we can build correct selectors
 */

import { chromium } from 'playwright';

const TEST_URL = 'https://carsandbids.com/auctions/3gNgmkXz/2008-toyota-camry-solara-sle-v6-convertible';

async function mapDOM() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       C&B DOM STRUCTURE MAPPER                                    ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  console.log('Warming up session...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
  console.log('Session ready!\n');

  // Navigate to auction
  console.log(`Loading: ${TEST_URL}\n`);
  await page.goto(TEST_URL, { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Scroll to load all content
  console.log('Scrolling to load all content...');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1: IMAGE GALLERY STRUCTURE
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  SECTION 1: IMAGE GALLERY STRUCTURE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const galleryInfo = await page.evaluate(() => {
    const info: any = {
      tabs: [],
      images: [],
      galleryContainer: null,
    };

    // Find gallery tabs (Exterior, Interior, etc.)
    document.querySelectorAll('button, a, [role="tab"]').forEach(el => {
      const text = el.textContent?.trim().toLowerCase() || '';
      if (['exterior', 'interior', 'mechanical', 'documents', 'documentation', 'all', 'show all'].some(t => text.includes(t))) {
        info.tabs.push({
          text: el.textContent?.trim(),
          tagName: el.tagName,
          className: el.className,
          selector: el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ').join('.') : ''),
        });
      }
    });

    // Find image containers
    const imgContainers = [
      '.gallery',
      '.image-gallery',
      '[class*="gallery"]',
      '[class*="Gallery"]',
      '[class*="carousel"]',
      '[class*="Carousel"]',
      '.photos',
      '[class*="photo"]',
    ];

    for (const selector of imgContainers) {
      const container = document.querySelector(selector);
      if (container) {
        info.galleryContainer = {
          selector,
          className: container.className,
          childCount: container.children.length,
        };
        break;
      }
    }

    // Find all images from media.carsandbids.com
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('data-src') || '';
      if (src.includes('carsandbids.com') || src.includes('media.carsandbids')) {
        info.images.push({
          src: src.substring(0, 150),
          width: img.width,
          height: img.height,
          alt: img.alt?.substring(0, 50),
          className: img.className?.substring(0, 50),
          parentClass: img.parentElement?.className?.substring(0, 50),
        });
      }
    });

    return info;
  });

  console.log('Gallery Tabs Found:');
  galleryInfo.tabs.forEach((t: any) => console.log(`  - "${t.text}" (${t.tagName}, class: ${t.className?.substring(0, 60)})`));

  console.log('\nGallery Container:', galleryInfo.galleryContainer);

  console.log(`\nImages Found: ${galleryInfo.images.length}`);
  console.log('Sample Image URLs:');
  galleryInfo.images.slice(0, 5).forEach((img: any) => {
    console.log(`  ${img.src}`);
    console.log(`    size: ${img.width}x${img.height}, class: ${img.className}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2: COMMENT STRUCTURE
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  SECTION 2: COMMENT STRUCTURE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // First, scroll to comments section
  console.log('Looking for comments section...');

  const commentsInfo = await page.evaluate(() => {
    const info: any = {
      possibleContainers: [],
      commentElements: [],
      sampleComments: [],
    };

    // Look for comment-related containers
    const commentPatterns = [
      'ul.thread',
      '.comments',
      '.comment-list',
      '[class*="comment"]',
      '[class*="Comment"]',
      '#comments',
      '.thread',
      '[class*="thread"]',
    ];

    for (const pattern of commentPatterns) {
      const els = document.querySelectorAll(pattern);
      if (els.length > 0) {
        info.possibleContainers.push({
          selector: pattern,
          count: els.length,
          firstClass: els[0].className?.substring(0, 100),
          firstTag: els[0].tagName,
          childCount: els[0].children?.length || 0,
        });
      }
    }

    // Look specifically for ul.thread > li (mentioned in cab-extract-comments-test.ts)
    const threadComments = document.querySelectorAll('ul.thread > li');
    if (threadComments.length > 0) {
      info.threadCommentsCount = threadComments.length;

      // Sample the first few comments
      for (let i = 0; i < Math.min(3, threadComments.length); i++) {
        const li = threadComments[i];
        const sample: any = {
          index: i,
          className: li.className,
          dataId: li.getAttribute('data-id'),
          innerHTML: li.innerHTML?.substring(0, 500),
        };

        // Try to find username
        const usernameEl = li.querySelector('.username a, .usericon-name a, a[title]');
        if (usernameEl) {
          sample.username = {
            text: usernameEl.textContent?.trim(),
            title: usernameEl.getAttribute('title'),
            href: usernameEl.getAttribute('href'),
            selector: '.username a or a[title]',
          };
        }

        // Try to find message text
        const messageEl = li.querySelector('.message p, .message, .content');
        if (messageEl) {
          sample.message = {
            text: messageEl.textContent?.trim()?.substring(0, 200),
            selector: '.message p or .message',
          };
        }

        // Try to find time
        const timeEl = li.querySelector('.time, time, [class*="time"]');
        if (timeEl) {
          sample.time = {
            text: timeEl.textContent?.trim(),
            selector: '.time',
          };
        }

        info.sampleComments.push(sample);
      }
    }

    return info;
  });

  console.log('Comment Containers Found:');
  commentsInfo.possibleContainers.forEach((c: any) => {
    console.log(`  ${c.selector}: ${c.count} elements, class="${c.firstClass}", children=${c.childCount}`);
  });

  if (commentsInfo.threadCommentsCount) {
    console.log(`\n✅ ul.thread > li: ${commentsInfo.threadCommentsCount} comments`);
  }

  console.log('\nSample Comment Structure:');
  commentsInfo.sampleComments.forEach((c: any, i: number) => {
    console.log(`\n  Comment ${i + 1}:`);
    console.log(`    class: ${c.className}`);
    console.log(`    data-id: ${c.dataId}`);
    if (c.username) {
      console.log(`    username: "${c.username.text}" (title: ${c.username.title})`);
      console.log(`    user href: ${c.username.href}`);
    }
    if (c.message) {
      console.log(`    message: "${c.message.text?.substring(0, 100)}..."`);
    }
    if (c.time) {
      console.log(`    time: "${c.time.text}"`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3: __NEXT_DATA__ CHECK
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  SECTION 3: __NEXT_DATA__ STRUCTURE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const nextDataInfo = await page.evaluate(() => {
    const scriptEl = document.getElementById('__NEXT_DATA__');
    if (!scriptEl) return { found: false };

    try {
      const data = JSON.parse(scriptEl.textContent || '{}');
      const props = data?.props?.pageProps || {};

      return {
        found: true,
        topLevelKeys: Object.keys(data),
        pagePropsKeys: Object.keys(props),
        hasAuction: !!props.auction,
        auctionKeys: props.auction ? Object.keys(props.auction) : [],
        hasComments: !!(props.auction?.comments || props.comments),
        commentsCount: props.auction?.comments?.length || props.comments?.length || 0,
        sampleCommentKeys: props.auction?.comments?.[0] ? Object.keys(props.auction.comments[0]) : [],
      };
    } catch (e: any) {
      return { found: true, error: e.message };
    }
  });

  if (nextDataInfo.found) {
    console.log('__NEXT_DATA__ Found!');
    console.log('  Top-level keys:', nextDataInfo.topLevelKeys);
    console.log('  pageProps keys:', nextDataInfo.pagePropsKeys);
    console.log('  Has auction:', nextDataInfo.hasAuction);
    console.log('  Auction keys:', nextDataInfo.auctionKeys?.slice(0, 15));
    console.log('  Has comments:', nextDataInfo.hasComments);
    console.log('  Comments count:', nextDataInfo.commentsCount);
    console.log('  Sample comment keys:', nextDataInfo.sampleCommentKeys);
  } else {
    console.log('__NEXT_DATA__ Not Found');
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4: RAW HTML DUMP OF COMMENT SECTION
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  SECTION 4: RAW COMMENT HTML (first comment)');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const rawCommentHtml = await page.evaluate(() => {
    const firstComment = document.querySelector('ul.thread > li');
    return firstComment?.outerHTML?.substring(0, 2000) || 'No comment found';
  });

  console.log(rawCommentHtml);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5: FULL IMAGE URL PATTERNS
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  SECTION 5: FULL IMAGE URL PATTERNS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const fullImageUrls = await page.evaluate(() => {
    const urls: string[] = [];
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.getAttribute('data-src') || '';
      if (src.includes('carsandbids')) {
        urls.push(src);
      }
    });
    return urls.slice(0, 20);
  });

  console.log('Full Image URLs:');
  fullImageUrls.forEach(url => console.log(`  ${url}`));

  // Keep browser open for manual inspection
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  Browser is open for manual inspection. Press Ctrl+C to close.');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Wait for manual inspection
  await page.waitForTimeout(300000); // 5 minutes

  await browser.close();
}

mapDOM().catch(console.error);
