import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
});
const page = await context.newPage();
await page.goto("https://carsandbids.com/past-auctions/?page=1", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3000);

const rawListings = await page.evaluate(() => {
  const seen = new Set();
  const results = [];

  document.querySelectorAll("a[href*='/auctions/']").forEach(link => {
    const href = link.href;
    const urlMatch = href.match(/\/auctions\/([A-Za-z0-9]+)\/(\d{4})-([^\/]+)/);
    if (urlMatch === null) return;

    const auctionId = urlMatch[1];
    if (seen.has(auctionId)) return;
    seen.add(auctionId);

    const card = link.closest("li, article, div") || link;
    const cardText = card.innerText || "";

    const priceMatch = cardText.match(/(?:Sold for|Bid to|Reserve not met at)\s*\$?([\d,]+)/i);
    const img = card.querySelector("img[src*='carsandbids']");

    const slug = urlMatch[3];
    const parts = slug.split("-");
    const make = parts[0];
    const model = parts.slice(1).join(" ");

    results.push({
      url: href.replace(/\/$/, ""),
      year: parseInt(urlMatch[2]),
      make: make,
      model: model,
      price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, "")) : null,
      thumbnail: img?.src || null,
      status: cardText.includes("Sold") ? "sold" : cardText.includes("Reserve not met") ? "reserve_not_met" : "ended",
    });
  });

  return results;
});

console.log("Found", rawListings.length, "listings");
console.log("Sample:");
rawListings.slice(0, 5).forEach(l => {
  console.log(`  ${l.year} ${l.make} ${l.model} - $${l.price} [${l.status}]`);
  console.log(`    URL: ${l.url}`);
  console.log(`    Thumb: ${l.thumbnail ? "yes" : "no"}`);
});

await browser.close();
