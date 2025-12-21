#!/usr/bin/env node
/**
 * Debug script for image loading issues in Nuke application
 * This will help identify:
 * 1. Broken image URLs
 * 2. American flag images that shouldn't be there
 * 3. Missing image variants
 * 4. Network connectivity issues
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

// Your Supabase URL from the example you provided
const SUPABASE_BASE = 'https://qkgaybvrernstplzjaam.supabase.co';

function isAmericanFlag(url) {
  const s = String(url || '').toLowerCase();
  return (
    s.includes('hello.zonos.com/images/flags/') ||
    s.includes('/flags/') && s.includes('.png') ||
    s.includes('flags/us.png') ||
    s.includes('flags/US.png') ||
    /(?:^|\/|\-|_)(flag|flags|banner)(?:$|\/|\-|_|\.)/i.test(s) ||
    s.includes('stars-and-stripes') ||
    s.includes('american-flag') ||
    s.includes('us-flag') ||
    s.includes('usa-flag')
  );
}

function testImageUrl(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve({ url, status: 'empty', error: 'No URL provided' });
      return;
    }

    try {
      const urlObj = new URL(url);

      if (isAmericanFlag(url)) {
        resolve({
          url,
          status: 'american_flag',
          error: 'This is an American flag image that should be filtered out',
          flagType: 'american_flag'
        });
        return;
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'HEAD',
        timeout: 10000,
        headers: {
          'User-Agent': 'Nuke-Image-Debug/1.0'
        }
      };

      const req = https.request(options, (res) => {
        resolve({
          url,
          status: res.statusCode,
          contentType: res.headers['content-type'],
          contentLength: res.headers['content-length'],
          error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null
        });
      });

      req.on('error', (error) => {
        resolve({
          url,
          status: 'error',
          error: error.message
        });
      });

      req.on('timeout', () => {
        resolve({
          url,
          status: 'timeout',
          error: 'Request timed out'
        });
        req.abort();
      });

      req.end();
    } catch (error) {
      resolve({
        url,
        status: 'invalid_url',
        error: `Invalid URL: ${error.message}`
      });
    }
  });
}

async function checkSupabaseImageUrls() {
  console.log('🔍 Checking Supabase image URLs...');

  // Test the specific URL you provided
  const testUrl = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/render/image/public/vehicle-images/bfb09094-6f73-4703-b5e2-820ce012c945/import_queue_1765867953290_0.jpg?width=420&quality=70';

  console.log('\n📸 Testing your example URL:');
  const result = await testImageUrl(testUrl);
  console.log(`Status: ${result.status}`);
  console.log(`Content Type: ${result.contentType || 'N/A'}`);
  console.log(`Error: ${result.error || 'None'}`);

  // Test some common flag URLs that might be causing issues
  const flagUrls = [
    'https://hello.zonos.com/images/flags/US.png',
    'https://example.com/flags/american-flag.png',
    'https://some-site.com/us-flag.jpg'
  ];

  console.log('\n🚩 Testing known flag URLs (these should be filtered):');
  for (const flagUrl of flagUrls) {
    const result = await testImageUrl(flagUrl);
    console.log(`${flagUrl}: ${result.status} ${result.flagType ? '(FLAGGED)' : ''}`);
  }
}

async function main() {
  console.log('🚀 Starting Nuke Image Debug Tool\n');

  await checkSupabaseImageUrls();

  console.log('\n✅ Debug complete!');
  console.log('\n💡 Next steps:');
  console.log('1. Check browser dev tools Network tab for failed image requests');
  console.log('2. Look for console errors related to CORS or authentication');
  console.log('3. Verify Supabase storage policies are correct');
  console.log('4. Check if images exist in the database but are missing from storage');

  console.log('\n🔧 To fix American flag issues:');
  console.log('- Images are already being filtered in the backend');
  console.log('- Check database for any existing flag images and remove them');
  console.log('- Verify that new image imports use the filtering logic');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testImageUrl, isAmericanFlag };