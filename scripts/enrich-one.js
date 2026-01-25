import { chromium } from 'playwright';

const url = 'https://www.mecum.com/lots/1139922/1958-chevrolet-corvette-convertible/';
const vehicleId = '1d7c2573-ee91-4dc6-b92e-b93887244dad';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
  console.log('Enriching:', url);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  
  const data = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    
    const findAfter = (label) => {
      const regex = new RegExp(label + '[:\\s]+([^\\n]+)', 'i');
      const match = bodyText.match(regex);
      return match?.[1]?.trim() || null;
    };
    
    const vinMatch = bodyText.match(/VIN\s*\/?\s*SERIAL[:\s]+([A-Z0-9]+)/i);
    const mileageMatch = bodyText.match(/ODOMETER[^\d]*([\d,]+)/i);
    const soldMatch = bodyText.match(/Sold[^\d$]*([\d,]+)/i);
    
    const highlightsMatch = bodyText.match(/HIGHLIGHTS([\s\S]*?)(?:PHOTOS|EQUIPMENT|Information found)/i);
    const highlights = highlightsMatch?.[1]?.split('\n').map(s => s.trim()).filter(s => s.length > 10 && s.length < 200).slice(0, 15) || [];
    
    const images = [...document.querySelectorAll('img')]
      .map(i => i.src)
      .filter(s => s && s.includes('mecum') && s.includes('upload'))
      .slice(0, 30);
    
    return {
      vin: vinMatch?.[1],
      mileage: mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, '')) : null,
      engine: findAfter('ENGINE'),
      transmission: findAfter('TRANSMISSION'),
      exterior_color: findAfter('EXTERIOR COLOR'),
      interior_color: findAfter('INTERIOR COLOR'),
      sold_price: soldMatch ? parseInt(soldMatch[1].replace(/,/g, '')) : null,
      highlights,
      images
    };
  });
  
  console.log('\n=== EXTRACTED ===');
  console.log('VIN:', data.vin);
  console.log('Mileage:', data.mileage);
  console.log('Engine:', data.engine);
  console.log('Transmission:', data.transmission);
  console.log('Ext Color:', data.exterior_color);
  console.log('Int Color:', data.interior_color);
  console.log('Sold Price:', data.sold_price);
  console.log('Images:', data.images.length);
  console.log('\nHighlights:');
  data.highlights.forEach(h => console.log('  •', h));
  
  // Update the vehicle
  const updateData = {
    vin: data.vin,
    mileage: data.mileage,
    engine_size: data.engine,
    transmission: data.transmission,
    color: data.exterior_color,
    interior_color: data.interior_color,
    sale_price: data.sold_price,
    highlights: data.highlights
  };
  
  Object.keys(updateData).forEach(k => { if (!updateData[k]) delete updateData[k]; });
  
  console.log('\nUpdating with:', Object.keys(updateData).join(', '));
  
  const res = await fetch(SUPABASE_URL + '/rest/v1/vehicles?id=eq.' + vehicleId, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updateData)
  });
  
  console.log('Update status:', res.ok ? 'SUCCESS' : 'FAILED');
  
  // Save images
  let imgSaved = 0;
  for (let i = 0; i < Math.min(data.images.length, 20); i++) {
    const imgRes = await fetch(SUPABASE_URL + '/rest/v1/vehicle_images', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        vehicle_id: vehicleId,
        image_url: data.images[i],
        source: 'mecum_detail',
        is_external: true,
        is_primary: i === 0,
        position: i
      })
    });
    if (imgRes.ok) imgSaved++;
  }
  console.log('Images saved:', imgSaved);
  
  await browser.close();
})();
