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
    console.log('🔑 Testing secrets access...');

    // Test all possible Claude API key names
    const claudeKeys = {
      'anthropic_api_key': (Deno.env.get('anthropic_api_key') ?? '').trim(),
      'NUKE_CLAUDE_API': (Deno.env.get('NUKE_CLAUDE_API') ?? '').trim(),
      'ANTHROPIC_API_KEY': (Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim(),
      'CLAUDE_API_KEY': (Deno.env.get('CLAUDE_API_KEY') ?? '').trim(),
    };

    // Test Firecrawl key
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

    const secretsReport = {
      claude_keys: {},
      firecrawl_key: firecrawlKey ? 'Present' : 'Missing',
      test_results: {}
    };

    // Report which Claude keys are present
    for (const [name, value] of Object.entries(claudeKeys)) {
      secretsReport.claude_keys[name] = value ? `Present (${value.substring(0, 8)}...)` : 'Missing';
    }

    // Test Claude API with the first available key
    const workingClaudeKey = claudeKeys['anthropic_api_key'] || claudeKeys['NUKE_CLAUDE_API'] || claudeKeys['ANTHROPIC_API_KEY'] || claudeKeys['CLAUDE_API_KEY'];

    if (workingClaudeKey) {
      console.log('Testing Claude API...');
      try {
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': workingClaudeKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 50,
            messages: [{
              role: 'user',
              content: 'Say "API test successful"'
            }]
          })
        });

        secretsReport.test_results.claude = {
          status: claudeResponse.status,
          success: claudeResponse.ok,
          key_used: workingClaudeKey.substring(0, 8) + '...'
        };

        if (!claudeResponse.ok) {
          const errorText = await claudeResponse.text();
          secretsReport.test_results.claude.error = errorText;
        }

      } catch (error: any) {
        secretsReport.test_results.claude = {
          error: error.message
        };
      }
    } else {
      secretsReport.test_results.claude = 'No Claude key available';
    }

    // Test Firecrawl API
    if (firecrawlKey) {
      console.log('Testing Firecrawl API...');
      try {
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: 'https://www.example.com',
            formats: ['markdown'],
            onlyMainContent: true
          })
        });

        secretsReport.test_results.firecrawl = {
          status: firecrawlResponse.status,
          success: firecrawlResponse.ok,
          key_used: firecrawlKey.substring(0, 8) + '...'
        };

        if (!firecrawlResponse.ok) {
          const errorText = await firecrawlResponse.text();
          secretsReport.test_results.firecrawl.error = errorText;
        }

      } catch (error: any) {
        secretsReport.test_results.firecrawl = {
          error: error.message
        };
      }
    } else {
      secretsReport.test_results.firecrawl = 'No Firecrawl key available';
    }

    console.log('Secrets report:', secretsReport);

    return new Response(JSON.stringify({
      success: true,
      secrets_report: secretsReport
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ Secrets test error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});