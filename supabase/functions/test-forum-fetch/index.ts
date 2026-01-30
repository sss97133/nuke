import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(JSON.stringify({ error: 'url required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Fetching:', url);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    const html = await response.text();

    // Count thread links using regex
    const threadPattern = /id="thread_title_(\d+)"/g;
    const matches = [...html.matchAll(threadPattern)];

    // Check for bot detection
    const botIndicators = {
      checking_browser: html.includes('Checking your browser'),
      cloudflare: html.includes('cloudflare') || html.includes('cf-'),
      captcha: html.includes('captcha'),
      access_denied: html.includes('Access Denied') || html.includes('403'),
      blocked: html.includes('blocked') || html.includes('not allowed'),
    };

    const result = {
      status: response.status,
      htmlLength: html.length,
      threadsFound: matches.length,
      sampleThreadIds: matches.slice(0, 5).map(m => m[1]),
      botIndicators,
      htmlSnippet: html.slice(0, 1000),
    };

    console.log('Result:', JSON.stringify({ status: response.status, htmlLength: html.length, threadsFound: matches.length }));

    return new Response(JSON.stringify(result, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
