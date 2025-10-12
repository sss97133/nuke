import puppeteer from 'puppeteer';

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
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // Navigate and wait for content
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for key elements
    await page.waitForSelector('h1', { timeout: 5000 }).catch(() => {});
    
    // Extract structured data
    const data = await page.evaluate(() => {
      const result = {
        title: document.querySelector('h1')?.textContent?.trim(),
        description: '',
        mileage: null,
        vin: null,
        engine: null,
        transmission: null,
        color: null,
        images: []
      };
      
      // Look for JSON-LD structured data first
      const jsonLd = document.querySelector('script[type="application/ld+json"]');
      if (jsonLd) {
        try {
          const structured = JSON.parse(jsonLd.textContent);
          if (structured.name) result.title = structured.name;
          if (structured.description) result.description = structured.description;
          if (structured.image) {
            result.images = Array.isArray(structured.image) ? structured.image : [structured.image];
          }
        } catch (e) {}
      }
      
      // Get all text content for parsing
      const bodyText = document.body.textContent || '';
      
      // Extract mileage
      const mileagePatterns = [
        /(\d{1,3})k\s+Miles?\s+Shown/i,
        /(\d{1,3}(?:,\d{3})*)\s+Miles?\s+Shown/i,
        /(\d{1,3}(?:,\d{3})*)\s+miles?/i
      ];
      
      for (const pattern of mileagePatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          let mileage = match[1].replace(/,/g, '');
          if (match[0].toLowerCase().includes('k')) {
            mileage = mileage + '000';
          }
          result.mileage = mileage;
          break;
        }
      }
      
      // Extract VIN
      const vinMatch = bodyText.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      if (vinMatch) {
        result.vin = vinMatch[1];
      }
      
      // Extract engine
      const engineMatch = bodyText.match(/(\d+\.?\d*)[-\s]*Liter\s+V(\d+)/i);
      if (engineMatch) {
        result.engine = {
          size: engineMatch[1],
          type: `V${engineMatch[2]}`
        };
      }
      
      // Extract transmission
      const transMatch = bodyText.match(/(\d+)[-\s]*Speed\s+(Automatic|Manual)/i);
      if (transMatch) {
        result.transmission = `${transMatch[1]}-Speed ${transMatch[2]}`;
      }
      
      // Extract color
      const colorMatch = bodyText.match(/([A-Za-z]+(?:\s+&\s+[A-Za-z]+)?)\s+Paint/i);
      if (colorMatch) {
        result.color = colorMatch[1];
      }
      
      // Get high-quality images
      const imageElements = document.querySelectorAll('img[src*="uploads"]');
      imageElements.forEach(img => {
        const src = img.src;
        if (src && !result.images.includes(src) && img.width > 200) {
          result.images.push(src);
        }
      });
      
      return result;
    });
    
    // Parse title for year/make/model
    if (data.title) {
      const yearMatch = data.title.match(/\b(19|20)\d{2}\b/);
      const parts = data.title.split(/\s+/).filter(p => !p.match(/\b(19|20)\d{2}\b/));
      
      data.year = yearMatch ? yearMatch[0] : null;
      data.make = parts[0] || null;
      data.model = parts.slice(1).join(' ') || null;
    }
    
    return res.status(200).json({ success: true, data });
    
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
