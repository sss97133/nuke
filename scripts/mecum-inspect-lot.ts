#!/usr/bin/env npx tsx
/**
 * Inspect Mecum lot page for all available data
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://www.mecum.com/lots/1158457/2017-ferrari-laferrari-aperta/';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const data = await page.evaluate(() => {
    const script = document.querySelector('script#__NEXT_DATA__');
    if (!script) return { error: 'No __NEXT_DATA__ found' };

    const nd = JSON.parse(script.textContent || '{}');
    const post = nd.props?.pageProps?.post || {};
    const acf = post.lotFields || {};

    return {
      // Basic info
      title: post.title,
      databaseId: post.databaseId,
      slug: post.slug,

      // Breadcrumbs for auction name
      breadcrumbs: post.seo?.breadcrumbs?.map((b: any) => b.text),

      // Lot fields (ACF)
      lotNumber: acf.lotNumber,
      vin: acf.vin,
      mileage: acf.mileage,
      engine: acf.engine,
      transmission: acf.transmission,
      exteriorColor: acf.exteriorColor,
      interiorColor: acf.interiorColor,
      bodyStyle: acf.bodyStyle,

      // Sale info
      salePrice: acf.salePrice,
      highBid: acf.highBid,
      bidTo: acf.bidTo,
      estimate: acf.estimate,
      reserve: acf.reserve,
      status: acf.status,
      sold: acf.sold,

      // Content
      highlights: acf.highlights,
      equipment: acf.equipment,
      description: post.content?.slice(0, 1000),

      // Images
      featuredImage: post.featuredImage?.node?.sourceUrl,
      galleryCount: acf.gallery?.length,
      galleryUrls: acf.gallery?.slice(0, 5)?.map((g: any) => g.sourceUrl),

      // All ACF field keys for discovery
      allLotFieldKeys: Object.keys(acf),
    };
  });

  console.log(JSON.stringify(data, null, 2));

  await browser.close();
}

main().catch(console.error);
