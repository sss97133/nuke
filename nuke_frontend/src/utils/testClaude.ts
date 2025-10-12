// Simple test to validate Claude API key
export async function testClaudeConnection(): Promise<{ success: boolean; error?: string; details?: any }> {
  const apiKey = import.meta.env.VITE_CLAUDE_API_KEY;
  
  if (!apiKey) {
    return { success: false, error: 'No Claude API key found' };
  }

  try {
    // Test with a simple text completion
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', // Use cheaper model for testing
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Say "Claude API connection successful"'
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        error: `HTTP ${response.status}: ${response.statusText}`,
        details: {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: response.url,
          headers: Object.fromEntries(response.headers.entries())
        }
      };
    }

    const data = await response.json();
    return { 
      success: true, 
      details: {
        message: data.content[0]?.text,
        model: data.model,
        usage: data.usage
      }
    };

  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error
    };
  }
}
