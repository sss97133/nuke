import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🧪 Testing minimal Claude API call...');

    const claudeApiKey = Deno.env.get('anthropic_api_key');
    if (!claudeApiKey) {
      throw new Error('anthropic_api_key not found');
    }

    console.log(`Using key starting with: ${claudeApiKey.substring(0, 10)}...`);

    // Try the latest API version first
    const testLatestVersion = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${claudeApiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2023-12-15'
      },
      body: JSON.stringify({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Hi'
        }]
      })
    });

    const result = {
      api_key_prefix: claudeApiKey.substring(0, 10) + '...',
      latest_version: {
        status: testLatestVersion.status,
        success: testLatestVersion.ok
      }
    };

    if (!testLatestVersion.ok) {
      const errorText = await testLatestVersion.text();
      result.latest_version.error = errorText;
      console.log('Latest version error:', errorText);

      // Try without beta header
      const testWithoutBeta = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${claudeApiKey}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 10,
          messages: [{
            role: 'user',
            content: 'Hi'
          }]
        })
      });

      result.without_beta = {
        status: testWithoutBeta.status,
        success: testWithoutBeta.ok
      };

      if (!testWithoutBeta.ok) {
        const errorText2 = await testWithoutBeta.text();
        result.without_beta.error = errorText2;
        console.log('Without beta error:', errorText2);

        // Try older API version
        const testOlderVersion = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${claudeApiKey}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-01-01'
          },
          body: JSON.stringify({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 10,
            messages: [{
              role: 'user',
              content: 'Hi'
            }]
          })
        });

        result.older_version = {
          status: testOlderVersion.status,
          success: testOlderVersion.ok
        };

        if (!testOlderVersion.ok) {
          const errorText3 = await testOlderVersion.text();
          result.older_version.error = errorText3;
        }
      }
    } else {
      const responseData = await testLatestVersion.json();
      result.latest_version.response = responseData;
    }

    return new Response(JSON.stringify({
      success: true,
      test_results: result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ Minimal Claude test error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});