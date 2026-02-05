import { chromium } from 'playwright';

const url = 'https://www.facebook.com/marketplace/item/2123863061707922';

async function scrape() {
  // Use separate session dir
  const context = await chromium.launchPersistentContext('./fb-session-test', {
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });

  const page = await context.newPage();
  
  try {
    console.log('Navigating...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const title = await page.$eval('meta[property="og:title"]', el => el.getAttribute('content')).catch(() => null);
    const desc = await page.$eval('meta[property="og:description"]', el => el.getAttribute('content')).catch(() => null);

    const imgs = await page.$$eval('img[src*="fbcdn"]', imgs => 
      imgs.map(i => i.src).filter(s => s.includes('scontent')).filter((s,i,a) => a.indexOf(s) === i)
    ).catch(() => []);

    const text = await page.$eval('body', el => el.innerText).catch(() => '');

    console.log('\nTitle:', title);
    console.log('Desc:', desc);
    console.log('Images found:', imgs.length);
    console.log('\n--- PAGE TEXT ---\n');
    console.log(text.slice(0, 4000));

  } finally {
    await context.close();
  }
}

scrape();
