import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  
  if (!url || !url.includes('bringatrailer.com')) {
    return res.status(400).json({ error: 'Invalid BAT URL' });
  }

  let browser;
  
  try {
    // Use chromium for Vercel deployment
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    
    const page = await browser.newPage();
    
    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Navigate to the page
    await page.goto(url, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });
    
    // Wait for content to load
    await page.waitForSelector('body', { timeout: 10000 });
    
    // Extract all the data we need
    const data = await page.evaluate(() => {
      const result = {};
      
      // Get title
      const h1 = document.querySelector('h1');
      if (h1) {
        result.title = h1.textContent.trim();
      }
      
      // Get all text for parsing
      const bodyText = document.body.textContent || '';
      
      // Find BaT Essentials section
      const essentialsSection = Array.from(document.querySelectorAll('*')).find(el => 
        el.textContent.includes('BaT Essentials')
      );
      
      if (essentialsSection) {
        const essentialsText = essentialsSection.textContent;
        
        // Extract from BaT Essentials
        const mileageMatch = essentialsText.match(/(\d{1,3}(?:,\d{3})*k?)\s*(?:Miles|mi)/i);
        if (mileageMatch) {
          let mileage = mileageMatch[1].replace(/,/g, '');
          if (mileage.includes('k')) {
            mileage = mileage.replace('k', '000');
          }
          result.mileage = mileage;
        }
        
        const vinMatch = essentialsText.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
        if (vinMatch) {
          result.vin = vinMatch[1];
        }
      }
      
      // Parse from full text if not found
      if (!result.mileage) {
        const mileageMatch = bodyText.match(/(\d{1,3}(?:,\d{3})*)\s*miles?\s*(?:shown|indicated)?/i);
        if (mileageMatch) {
          result.mileage = mileageMatch[1].replace(/,/g, '');
        }
      }
      
      if (!result.vin) {
        const vinMatch = bodyText.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
        if (vinMatch) {
          result.vin = vinMatch[1];
        }
      }
      
      // Engine
      const engineMatch = bodyText.match(/(\d+\.?\d*)[-\s]*(?:Liter|L)\s+V(\d+)/i);
      if (engineMatch) {
        result.engine_size = engineMatch[1];
        result.engine_type = `V${engineMatch[2]}`;
      }
      
      // Transmission
      const transMatch = bodyText.match(/(\d+)[-\s]*Speed\s+(Manual|Automatic)/i);
      if (transMatch) {
        result.transmission = `${transMatch[1]}-Speed ${transMatch[2]}`;
      }
      
      // Color
      const colorMatch = bodyText.match(/([A-Za-z]+)\s+(?:Paint|Exterior)/i);
      if (colorMatch) {
        result.color = colorMatch[1];
      }
      
      // Sale price
      const priceMatch = bodyText.match(/Sold\s+for\s+\$?([\d,]+)/i);
      if (priceMatch) {
        result.sale_price = parseInt(priceMatch[1].replace(/,/g, ''));
      }
      
      // Get images
      const images = [];
      document.querySelectorAll('img').forEach(img => {
        const src = img.src;
        if (src && src.includes('uploads') && !images.includes(src)) {
          images.push(src);
        }
      });
      result.images = images.slice(0, 20);
      
      return result;
    });
    
    // Parse year/make/model from title
    if (data.title) {
      const yearMatch = data.title.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        data.year = yearMatch[0];
      }
      
      const cleanTitle = data.title.replace(/^(No Reserve:|Modified|Restored):\s*/i, '');
      const parts = cleanTitle.split(/\s+/);
      let startIndex = 0;
      if (parts[0]?.match(/\b(19|20)\d{2}\b/)) {
        startIndex = 1;
      }
      if (parts.length > startIndex) {
        data.make = parts[startIndex];
        data.model = parts.slice(startIndex + 1).join(' ');
      }
    }
    
    return res.status(200).json({ 
      success: true, 
      data,
      source: 'Bring a Trailer',
      listing_url: url
    });
    
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
