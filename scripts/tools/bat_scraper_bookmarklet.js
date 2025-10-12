javascript:(function(){
  const data = {};
  
  // Get title
  const h1 = document.querySelector('h1');
  if (h1) {
    data.title = h1.textContent.trim();
    
    // Parse year/make/model
    const yearMatch = data.title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) data.year = yearMatch[0];
    
    const cleanTitle = data.title.replace(/^(No Reserve:|Modified|Restored):\s*/i, '');
    const parts = cleanTitle.split(/\s+/);
    let startIndex = parts[0]?.match(/\b(19|20)\d{2}\b/) ? 1 : 0;
    if (parts.length > startIndex) {
      data.make = parts[startIndex];
      data.model = parts.slice(startIndex + 1).join(' ');
    }
  }
  
  const bodyText = document.body.textContent || '';
  
  // Mileage
  const mileageMatch = bodyText.match(/(\d{1,3})k?\s+Miles?\s+Shown/i) ||
                       bodyText.match(/(\d{1,3}(?:,\d{3})*)\s+miles?/i);
  if (mileageMatch) {
    let mileage = mileageMatch[1].replace(/,/g, '');
    if (mileageMatch[0].includes('k')) mileage += '000';
    data.mileage = mileage;
  }
  
  // VIN
  const vinMatch = bodyText.match(/(?:VIN|Chassis)[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
  if (vinMatch) data.vin = vinMatch[1];
  
  // Engine
  const engineMatch = bodyText.match(/(\d+\.?\d*)[-\s]*(?:Liter|L)\s+V(\d+)/i);
  if (engineMatch) data.engine = `${engineMatch[1]}L V${engineMatch[2]}`;
  
  // Transmission
  const transMatch = bodyText.match(/(\d+)[-\s]*Speed\s+(Manual|Automatic)/i);
  if (transMatch) data.transmission = `${transMatch[1]}-Speed ${transMatch[2]}`;
  
  // Color
  const colorMatch = bodyText.match(/([A-Za-z]+)\s+Paint/i);
  if (colorMatch) data.color = colorMatch[1];
  
  // Images
  const images = [];
  document.querySelectorAll('img[src*="uploads"]').forEach(img => {
    if (!images.includes(img.src)) images.push(img.src);
  });
  data.images = images.slice(0, 20);
  
  // Copy to clipboard
  navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
    alert('Vehicle data copied to clipboard! Paste it in the AddVehicle form.');
  });
  
  console.log('Extracted data:', data);
})();
