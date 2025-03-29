// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { Cheerio, cheerio } from 'https://deno.land/x/cheerio@1.0.7/mod.ts';

console.log('Initializing scrape-craigslist function');

interface ScrapedData {
  title?: string;
  price?: string;
  location?: string;
  description?: string;
  images?: string[];
  error?: string;
}

async function fetchAndScrape(url: string): Promise<ScrapedData> {
  try {
    console.log(`Fetching URL: ${url}`);
    const response = await fetch(url, {
      headers: {
        // Try to mimic a browser to avoid simple blocks
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      return { error: `Failed to fetch URL: ${response.status} ${response.statusText}` };
    }

    const html = await response.text();
    console.log('Successfully fetched HTML, attempting to parse...');
    const $ = cheerio.load(html);

    // --- Scraping Logic (highly dependent on Craigslist structure) ---

    const title = $('#titletextonly').text().trim() || $('span.postingtitletext').text().trim();
    const price = $('.price').first().text().trim();
    const locationText = $('.postingtitletext small').text().trim();
    // Clean up location text (e.g., " (Pahrump)" -> "Pahrump")
    const location = locationText.replace(/\(|\)/g, '').trim();
    
    // Get description - handle potential line breaks
    let description = $('#postingbody').text().trim();
    // Remove the initial "QR Code Link to This Post" if present
    description = description.replace(/^QR Code Link to This Post\s*/, '').trim();

    const images: string[] = [];
    $('#thumbs a').each((_, element) => {
      const imgUrl = $(element).attr('href');
      if (imgUrl) {
        images.push(imgUrl);
      }
    });
    // If no thumbs, try the main image
    if (images.length === 0) {
        const mainImage = $('.slide.first.visible img').attr('src');
        if (mainImage) {
            images.push(mainImage);
        }
    }

    console.log('Parsing complete.', { title, price, location, imageCount: images.length });

    return {
      title,
      price,
      location,
      description,
      images,
    };
  } catch (error) {
    console.error('Error during scraping:', error);
    return { error: error instanceof Error ? error.message : 'An unknown error occurred during scraping' };
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('Handling OPTIONS request');
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    console.log(`Received request to scrape URL: ${url}`);

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      console.error('Invalid URL provided');
      return new Response(JSON.stringify({ error: 'Invalid URL provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const data = await fetchAndScrape(url);

    console.log('Sending back scraped data:', data);
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: data.error ? 500 : 200, // Use 500 if scraping failed
    });
  } catch (error) {
    console.error('General error handling request:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
