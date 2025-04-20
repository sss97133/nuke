// Dedicated extractor for Bring a Trailer
function extractFromBringATrailer() {
  // ... (same extraction logic as before)
}

// Generic extractor for unknown sites
function extractGeneric() {
  // ... (same extraction logic as before)
}

// Dedicated extractor for Craigslist
function extractFromCraigslist() {
  // ... (same extraction logic as before)
}

// Dedicated extractor for Barn Finds
function extractFromBarnFinds() {
  // ... (same extraction logic as before)
}

// Dedicated extractor for KSL Cars
function extractFromKslCars() {
  // ... (same extraction logic as before)
}

function getCurrentSite() {
  // ... (same detection logic as before)
}

function extractVehicleData() {
  // ... (same switch logic as before)
}

// Save a hard copy of the current page as HTML
function savePageHtmlCopy() {
  const html = document.documentElement.outerHTML;
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const filename = (document.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'vehidex_page') + '.html';
  chrome.runtime.sendMessage({ action: 'downloadHtmlCopy', url, filename });
}

// Listen for messages from the popup to trigger extraction and HTML save
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractVehicleData') {
    const data = extractVehicleData();
    const html = document.documentElement.outerHTML;
    sendResponse({ ...data, html }); // send back structured data and html copy
  }
});
