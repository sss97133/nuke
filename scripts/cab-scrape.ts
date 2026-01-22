/**
 * Cars & Bids scraper using Playwright
 * Extracts ALL data from auction pages
 */

import { chromium } from 'playwright';

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // First check total auctions on the site
    console.log('=== CHECKING TOTAL AUCTIONS ===\n');
    await page.goto('https://carsandbids.com/search', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    let content = await page.content();

    // Look for total count in search results
    const totalMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*(?:results?|listings?|auctions?|vehicles?)/i);
    if (totalMatch) {
      console.log('Total auctions found:', totalMatch[0]);
    }

    // Check past auctions page for total sold
    console.log('\n=== CHECKING SOLD AUCTIONS ===\n');
    await page.goto('https://carsandbids.com/past-auctions', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    content = await page.content();
    const soldMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*(?:results?|sold|completed)/i);
    if (soldMatch) {
      console.log('Sold auctions:', soldMatch[0]);
    }

    // Count auction cards on the page
    const auctionCards = await page.$$('[class*="auction"], [class*="listing"], a[href*="/auctions/"]');
    console.log('Auction cards on page:', auctionCards.length);

    // Now extract a full auction
    console.log('\n=== EXTRACTING SPECIFIC AUCTION ===\n');
    await page.goto('https://carsandbids.com/auctions/KZD4n7pQ/2023-aston-martin-vantage-roadster', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(5000);

    content = await page.content();
    const title = await page.title();

    // Extract VIN from title
    const vinFromTitle = title.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i);
    console.log('VIN:', vinFromTitle?.[1] || 'not found');

    // Extract mileage
    const mileageMatch = content.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi\b)/i);
    console.log('Mileage:', mileageMatch?.[1] || 'not found');

    // Extract current bid
    const bidMatch = content.match(/Current Bid[:\s]*\$?([\d,]+)/i) || content.match(/Bid[:\s]*\$?([\d,]+)/i);
    console.log('Current Bid:', bidMatch?.[1] ? '$' + bidMatch[1] : 'not found');

    // Extract bid count
    const bidCountMatch = content.match(/(\d+)\s*(?:bids?)/i);
    console.log('Bid Count:', bidCountMatch?.[1] || 'not found');

    // Extract comment count
    const commentCountMatch = content.match(/(\d+)\s*(?:comments?)/i);
    console.log('Comment Count:', commentCountMatch?.[1] || 'not found');

    // Extract location
    const locationMatch = content.match(/(?:Location|Located)[:\s]*([A-Za-z\s,]+(?:,\s*[A-Z]{2}))/i);
    console.log('Location:', locationMatch?.[1]?.trim() || 'not found');

    // Extract seller
    const sellerMatch = content.match(/(?:Seller|Sold by)[:\s]*@?(\w+)/i);
    console.log('Seller:', sellerMatch?.[1] || 'not found');

    // Extract end date
    const endDateMatch = content.match(/(?:Ends?|Ending|Auction ends?)[:\s]*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    console.log('End Date:', endDateMatch?.[1] || 'not found');

    // Extract all images
    const images = await page.$$eval('img[src*="carsandbids"], img[src*="media."], [class*="gallery"] img', imgs =>
      imgs.map((img: any) => img.src).filter((src: string) => src && !src.includes('avatar') && !src.includes('logo'))
    );
    console.log('Images found:', images.length);
    if (images[0]) {
      console.log('First image:', images[0].substring(0, 100));
    }

    // Try to get structured data (JSON-LD)
    const jsonLd = await page.$('script[type="application/ld+json"]');
    if (jsonLd) {
      const jsonLdContent = await jsonLd.textContent();
      if (jsonLdContent) {
        try {
          const structured = JSON.parse(jsonLdContent);
          console.log('\n=== STRUCTURED DATA (JSON-LD) ===');
          console.log(JSON.stringify(structured, null, 2).substring(0, 1500));
        } catch (e) {
          console.log('Could not parse JSON-LD');
        }
      }
    }

    // Check for comments section
    console.log('\n=== CHECKING COMMENTS ===');
    const commentsSection = await page.$('[class*="comment"], [id*="comment"], [data-testid*="comment"]');
    if (commentsSection) {
      console.log('Comments section found!');
      const commentText = await commentsSection.textContent();
      console.log('Sample:', commentText?.substring(0, 500));
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
}

main();
