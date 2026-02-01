#!/usr/bin/env npx tsx
/**
 * Deep inspect Mecum lot page - find ALL data
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://www.mecum.com/lots/1158457/2017-ferrari-laferrari-aperta/';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const data = await page.evaluate(() => {
    const script = document.querySelector('script#__NEXT_DATA__');
    if (!script) return { error: 'No __NEXT_DATA__' };

    const nd = JSON.parse(script.textContent || '{}');
    const post = nd.props?.pageProps?.post || {};
    const apollo = nd.props?.pageProps?.__APOLLO_STATE__ || {};

    // Find the Lot type in Apollo cache
    const lotKeys = Object.keys(apollo).filter(k => k.startsWith('Lot:'));
    const lotData = lotKeys.length ? apollo[lotKeys[0]] : null;

    // Get all images from Apollo
    const imageKeys = Object.keys(apollo).filter(k => k.startsWith('MediaItem:'));
    const images = imageKeys.map(k => apollo[k]?.sourceUrl).filter(Boolean);

    // Scrape visible text for specs
    const bodyText = document.body.innerText;
    const findSpec = (label: string) => {
      const regex = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
      return bodyText.match(regex)?.[1]?.trim();
    };

    return {
      // From post
      title: post.title,
      breadcrumbs: post.seo?.breadcrumbs?.map((b: any) => b.text),

      // From Apollo Lot
      lotData: lotData ? {
        vin: lotData.vin,
        lotNumber: lotData.lotNumber,
        mileage: lotData.mileage,
        engine: lotData.engine,
        transmission: lotData.transmission,
        exteriorColor: lotData.exteriorColor,
        interiorColor: lotData.interiorColor,
        salePrice: lotData.salePrice,
        highBid: lotData.highBid,
        estimate: lotData.estimate,
        highlights: lotData.highlights,
        equipment: lotData.equipment,
        allKeys: Object.keys(lotData),
      } : null,

      // Images from Apollo
      imageCount: images.length,
      sampleImages: images.slice(0, 5),

      // Scraped from visible page
      scrapedSpecs: {
        vin: findSpec('VIN'),
        lot: findSpec('LOT'),
        engine: findSpec('ENGINE'),
        transmission: findSpec('TRANSMISSION'),
        exterior: findSpec('EXTERIOR'),
        interior: findSpec('INTERIOR'),
        mileage: findSpec('ODOMETER'),
      },
    };
  });

  console.log(JSON.stringify(data, null, 2));

  await browser.close();
}

main().catch(console.error);
